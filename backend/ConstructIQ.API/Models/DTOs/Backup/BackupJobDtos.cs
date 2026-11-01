using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Backup;

// What the unattended script POSTs to /api/v1/system/backup-jobs/report,
// authenticated by a shared token (see BackupReportTokenFilter), never a
// user JWT. Deliberately narrow — this identity can only describe a job
// outcome, nothing else.
public class BackupJobReportDto
{
    [Required] public string JobType { get; set; } = string.Empty; // BackupJobType name
    [Required] public string Trigger { get; set; } = string.Empty; // BackupTrigger name
    [Required] public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public bool? LocalSuccess { get; set; }
    public bool? CloudSuccess { get; set; }
    public string? SnapshotIdLocal { get; set; }
    public string? SnapshotIdCloud { get; set; }
    public string? FullChainTag { get; set; }
    public string? BinlogFileStart { get; set; }
    public string? BinlogFileEnd { get; set; }
    public long? BytesProcessed { get; set; }
    public string? ErrorMessage { get; set; }
    public string? HostName { get; set; }
}

public class BackupJobRunDto
{
    public int Id { get; set; }
    public string JobType { get; set; } = string.Empty;
    public string Trigger { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public bool? LocalSuccess { get; set; }
    public bool? CloudSuccess { get; set; }
    public string? FullChainTag { get; set; }
    public long? BytesProcessed { get; set; }
    public string? ErrorMessage { get; set; }
}

// Every field here is read straight from real BackupJobRun rows — never a
// config-presence flag. "Complete" only when both a local AND a cloud
// destination have an actual successful run on record.
public class BackupStatusDto
{
    public DateTime? LastSuccessfulLocalBackup { get; set; }
    public DateTime? LastSuccessfulCloudCopy { get; set; }
    public DateTime? LastSuccessfulFullBackup { get; set; }
    public DateTime? LatestIncrementalRecoveryPoint { get; set; }
    public DateTime? LastRestoreVerification { get; set; }
    public string ArrangementStatus { get; set; } = "NeverRun"; // Complete | MissingLocalDevice | MissingCloudDestination | NeverRun
    public List<BackupJobRunDto> RecentJobs { get; set; } = [];
}

public class TriggerBackupJobDto
{
    [Required] public string JobType { get; set; } = string.Empty; // "DailyIncremental" | "WeeklyFull"
}
