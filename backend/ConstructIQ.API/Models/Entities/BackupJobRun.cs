using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

public enum BackupJobType { DailyIncremental, WeeklyFull, Restore, Prune }
public enum BackupTrigger { Scheduled, Manual }

// One row per execution of a backup/restore/prune script (Backup-Daily.ps1,
// Backup-Weekly.ps1, Restore-Local.ps1, Restore-Cloud.ps1, or the retention
// prune step), reported by the unattended script itself via
// BackupOperationsController's token-guarded /report endpoint — never
// written by an interactively-authenticated admin. This is the single
// source of truth the admin status panel reads from; it must never be
// inferred from config flags (see BackupJobService.GetStatusAsync).
public class BackupJobRun
{
    public int Id { get; set; }

    public BackupJobType JobType { get; set; }
    public BackupTrigger Trigger { get; set; }

    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    // Tracked independently — a local success must never be presented as an
    // off-site success. Null until the corresponding step actually ran (e.g.
    // a local-only test run leaves CloudSuccess null, not false).
    public bool? LocalSuccess { get; set; }
    public bool? CloudSuccess { get; set; }

    [MaxLength(200)] public string? SnapshotIdLocal { get; set; }
    [MaxLength(200)] public string? SnapshotIdCloud { get; set; }

    // Groups a WeeklyFull run with every DailyIncremental taken before the
    // next full — restic's retention prune operates on this whole chain at
    // once, so a full is never pruned while a dependent incremental is still
    // retained (or vice versa). Format: "full-id:<StartedAt O-format>".
    [MaxLength(64)] public string? FullChainTag { get; set; }

    [MaxLength(255)] public string? BinlogFileStart { get; set; }
    [MaxLength(255)] public string? BinlogFileEnd { get; set; }

    public long? BytesProcessed { get; set; }

    // Sanitized by the reporting script before it's ever sent — never a raw
    // exception message that could contain a connection string, file path,
    // or credential. See BackupJobDtos.BackupJobReportDto.
    [MaxLength(1000)] public string? ErrorMessage { get; set; }

    [MaxLength(100)] public string? HostName { get; set; }
}
