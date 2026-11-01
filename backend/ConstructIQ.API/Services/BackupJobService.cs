using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Backup;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class BackupJobService(AppDbContext db) : IBackupJobService
{
    public async Task ReportAsync(BackupJobReportDto dto)
    {
        db.BackupJobRuns.Add(new BackupJobRun
        {
            JobType         = Enum.Parse<BackupJobType>(dto.JobType),
            Trigger         = Enum.Parse<BackupTrigger>(dto.Trigger),
            StartedAt       = dto.StartedAt,
            CompletedAt     = dto.CompletedAt,
            LocalSuccess    = dto.LocalSuccess,
            CloudSuccess    = dto.CloudSuccess,
            SnapshotIdLocal = dto.SnapshotIdLocal,
            SnapshotIdCloud = dto.SnapshotIdCloud,
            FullChainTag    = dto.FullChainTag,
            BinlogFileStart = dto.BinlogFileStart,
            BinlogFileEnd   = dto.BinlogFileEnd,
            BytesProcessed  = dto.BytesProcessed,
            ErrorMessage    = dto.ErrorMessage,
            HostName        = dto.HostName,
        });
        await db.SaveChangesAsync();
    }

    public async Task<IEnumerable<BackupJobRunDto>> GetHistoryAsync(int take = 50) =>
        (await db.BackupJobRuns.OrderByDescending(r => r.StartedAt).Take(take).ToListAsync())
            .Select(ToDto);

    // Every field is derived from real rows — never a config-presence check.
    // "Complete" requires an actual recorded successful run against BOTH
    // destinations, not merely that BACKUP_S3_BUCKET happens to be set.
    public async Task<BackupStatusDto> GetStatusAsync()
    {
        var rows = await db.BackupJobRuns.OrderByDescending(r => r.StartedAt).ToListAsync();

        var lastLocal = rows.FirstOrDefault(r => r.LocalSuccess == true &&
            r.JobType is BackupJobType.DailyIncremental or BackupJobType.WeeklyFull);
        var lastCloud = rows.FirstOrDefault(r => r.CloudSuccess == true &&
            r.JobType is BackupJobType.DailyIncremental or BackupJobType.WeeklyFull);
        var lastFull = rows.FirstOrDefault(r => r.JobType == BackupJobType.WeeklyFull && r.LocalSuccess == true);
        var lastIncremental = rows.FirstOrDefault(r => r.JobType == BackupJobType.DailyIncremental && r.LocalSuccess == true);
        var lastRestoreVerification = rows.FirstOrDefault(r => r.JobType == BackupJobType.Restore && r.LocalSuccess == true);

        var arrangementStatus =
            rows.Count == 0 ? "NeverRun" :
            lastLocal is null ? "MissingLocalDevice" :
            lastCloud is null ? "MissingCloudDestination" :
            "Complete";

        return new BackupStatusDto
        {
            LastSuccessfulLocalBackup      = lastLocal?.StartedAt,
            LastSuccessfulCloudCopy        = lastCloud?.StartedAt,
            LastSuccessfulFullBackup       = lastFull?.StartedAt,
            LatestIncrementalRecoveryPoint = lastIncremental?.CompletedAt ?? lastIncremental?.StartedAt,
            LastRestoreVerification        = lastRestoreVerification?.StartedAt,
            ArrangementStatus              = arrangementStatus,
            RecentJobs                     = rows.Take(20).Select(ToDto).ToList(),
        };
    }

    private static BackupJobRunDto ToDto(BackupJobRun r) => new()
    {
        Id             = r.Id,
        JobType        = r.JobType.ToString(),
        Trigger        = r.Trigger.ToString(),
        StartedAt      = r.StartedAt,
        CompletedAt    = r.CompletedAt,
        LocalSuccess   = r.LocalSuccess,
        CloudSuccess   = r.CloudSuccess,
        FullChainTag   = r.FullChainTag,
        BytesProcessed = r.BytesProcessed,
        ErrorMessage   = r.ErrorMessage,
    };
}
