using System.Security.Claims;
using System.Text.Json;
using ConstructIQ.API.Data;
using ConstructIQ.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

[ApiController, Route("api/v1/system"), Authorize(Policy = "AdminOnly")]
public class SystemBackupController(DatabaseBackupService backups, AppDbContext db,
    ILogger<SystemBackupController> logger) : ControllerBase
{
    [HttpGet("backup")]
    public async Task<IActionResult> Status() => Ok(new
    {
        createdAt = await db.ActivityLogs.Where(l => l.Action == "BACKUP_CREATED")
            .OrderByDescending(l => l.CreatedAt).Select(l => (DateTime?)l.CreatedAt).FirstOrDefaultAsync(),
    });

    [HttpPost("backup")]
    public async Task<IActionResult> Create(CancellationToken ct)
    {
        try
        {
            var result = await backups.CreateAsync(int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!),
                HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
            Response.Headers.CacheControl = "no-store";
            return File(result.Bytes, "application/json", $"constructiq-backup-{result.CreatedAt:yyyyMMdd-HHmmss}.json");
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("restore"), RequestSizeLimit(DatabaseBackupService.MaxBytes + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = DatabaseBackupService.MaxBytes + 1024 * 1024)]
    public async Task<IActionResult> Restore(IFormFile file, [FromForm] string confirmation, CancellationToken ct)
    {
        if (confirmation != "RESTORE" || file.Length == 0 || file.Length > DatabaseBackupService.MaxBytes ||
            !Path.GetExtension(file.FileName).Equals(".json", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "Select a valid JSON backup (up to 50 MB) and confirm with RESTORE." });
        try
        {
            await using var stream = file.OpenReadStream();
            await backups.RestoreAsync(stream, int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!),
                User.FindFirstValue("username") ?? "Administrator", HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
            HttpContext.Items["SkipActivityAudit"] = true;
            return Ok(new { message = "Database restored. All users must sign in again." });
        }
        catch (Exception ex) when (ex is JsonException or FormatException or InvalidOperationException or System.Data.Common.DbException)
        {
            db.ChangeTracker.Clear();
            logger.LogWarning(ex, "Database restore rejected or rolled back");
            return BadRequest(new { message = "Restore failed. The backup must be authentic and match this database schema. No changes were committed." });
        }
    }
}
