using System.Diagnostics;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Backup;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

// Automated 3-2-1 backup status/history/trigger endpoints — separate from
// the existing manual SystemBackupController (unchanged). Two distinct
// identities are deliberately kept apart here:
//   - AdminOnly (a real signed-in administrator): read status/history, and
//     ask the OS-scheduled task to run now.
//   - the backup service identity (the unattended Backup-*.ps1 scripts,
//     which have no user session to authenticate with): may ONLY report a
//     job outcome, via a shared token, and can never trigger a restore or
//     read anything back. This mirrors the task's requirement to separate
//     backup-writing permissions from administrative restore/deletion
//     permissions.
[ApiController]
[Route("api/v1/system/backup-jobs")]
public class BackupOperationsController(IBackupJobService jobs, AppDbContext db, IConfiguration config) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetHistory([FromQuery] int take = 50) =>
        Ok(await jobs.GetHistoryAsync(Math.Clamp(take, 1, 200)));

    [HttpGet("status")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetStatus() => Ok(await jobs.GetStatusAsync());

    // Never blocks the request for the duration of the backup itself — it
    // just asks the already-registered Windows Scheduled Task to run
    // immediately (schtasks /run), so there is exactly one execution path
    // and one lock (owned by the script), whether triggered by the
    // schedule or by this button.
    [HttpPost("trigger")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Trigger([FromBody] TriggerBackupJobDto dto)
    {
        var taskName = dto.JobType switch
        {
            "DailyIncremental" => "ConstructIQ-Backup-Daily",
            "WeeklyFull" => "ConstructIQ-Backup-Weekly",
            _ => null,
        };
        if (taskName is null)
            return BadRequest(new { message = "jobType must be DailyIncremental or WeeklyFull." });

        try
        {
            var psi = new ProcessStartInfo("schtasks", $"/run /tn \"{taskName}\"")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            using var process = Process.Start(psi)!;
            await process.WaitForExitAsync();
            if (process.ExitCode != 0)
            {
                var stderr = await process.StandardError.ReadToEndAsync();
                return StatusCode(502, new { message = $"Could not start the scheduled task '{taskName}'. Has Register-BackupSchedule.ps1 been run on this host? ({stderr.Trim()})" });
            }
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return StatusCode(502, new { message = "schtasks is unavailable in this environment. Trigger the backup manually per the runbook." });
        }

        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = CurrentUserId, Action = "BACKUP_JOB_TRIGGERED", EntityType = "System",
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            Details = $"Requested immediate run of scheduled task '{taskName}'.",
        });
        await db.SaveChangesAsync();
        return Accepted(new { message = $"Requested. '{taskName}' will report its own result once it finishes." });
    }

    // Called only by the unattended backup scripts — never by a browser
    // session. Guarded by a shared secret, not a user JWT, since no admin is
    // logged in when a 2 AM scheduled task runs.
    [HttpPost("report")]
    [AllowAnonymous]
    public async Task<IActionResult> Report([FromBody] BackupJobReportDto dto)
    {
        var expected = config["BACKUP_REPORT_TOKEN"];
        var provided = Request.Headers["X-Backup-Report-Token"].ToString();
        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(provided) ||
            !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(expected)))
            return Unauthorized();

        try
        {
            await jobs.ReportAsync(dto);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            return BadRequest(new { message = "Invalid job report payload." });
        }

        db.ActivityLogs.Add(new ActivityLog
        {
            UserId = null, Action = "BACKUP_JOB_REPORTED", EntityType = "System",
            Details = $"{dto.JobType} ({dto.Trigger}) reported: local={dto.LocalSuccess}, cloud={dto.CloudSuccess}.",
        });
        await db.SaveChangesAsync();
        return Ok();
    }
}
