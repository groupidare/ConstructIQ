<#
.SYNOPSIS
  Weekly full backup: a fresh, complete, standalone mysqldump of the whole
  database plus a full restic snapshot of wwwroot/uploads, encrypted and
  written to the local-device repo, then copied to the cloud repo.

.DESCRIPTION
  This is the REAL "weekly full" required by the 3-2-1 arrangement - not a
  deduplicated restic snapshot pretending to be one. mysqldump produces a
  complete, independently-restorable logical dump using the dedicated
  constructiq_backup identity (never the app's own root/DB_USER), recording
  the exact binlog file+position it was taken at (--source-data=2) so
  Backup-Daily.ps1 knows where to start archiving from. restic then wraps
  that dump file + the uploads folder for encryption, local/cloud
  replication, and retention - it is the transport layer here, not the
  database's incremental mechanism (see docs/backup-runbook.md).
#>
param([ValidateSet("Scheduled", "Manual")][string]$Trigger = "Scheduled")

. "$PSScriptRoot\Common.ps1"

$config = Get-BackupConfig
$startedAt = Get-Date
$lock = Enter-BackupLock -LockName "backup"

$localSuccess = $false
$cloudSuccess = $null
$errorMessage = $null
$snapshotIdLocal = $null
$snapshotIdCloud = $null
$chainTag = New-FullChainTag
$bytesProcessed = 0
$binlogFile = $null

try {
    Write-BackupLog "=== Weekly full backup starting (trigger=$Trigger, chain=$chainTag) ==="

    if (-not (Test-Path $config.BACKUP_STAGING_DIR)) { New-Item -ItemType Directory -Path $config.BACKUP_STAGING_DIR -Force | Out-Null }
    Test-DiskSpaceOrThrow -Path $config.BACKUP_STAGING_DIR
    Test-DiskSpaceOrThrow -Path $config.BACKUP_LOCAL_DEVICE_PATH

    $mysqldump = Get-MySqlExe -Config $config -Name "mysqldump.exe"
    $mysqlPwd = Get-BackupSecret -Config $config -Name "mysql-backup-user-password.txt"
    $dumpFile = Join-Path $config.BACKUP_STAGING_DIR ("full-{0}.sql" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

    Write-BackupLog "Running mysqldump (--single-transaction, InnoDB-consistent, no locking)..."
    $env:MYSQL_PWD = $mysqlPwd
    try {
        & $mysqldump -h $config.DB_HOST -P $config.DB_PORT -u $config.BACKUP_MYSQL_USER `
            --single-transaction --routines --triggers --events --hex-blob --source-data=2 `
            $config.DB_NAME 2>$null | Out-File -FilePath $dumpFile -Encoding utf8
        if ($LASTEXITCODE -ne 0) { throw "mysqldump exited with code $LASTEXITCODE" }
    }
    finally { Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue }

    $posLine = Select-String -Path $dumpFile -Pattern "^-- CHANGE (?:MASTER TO|REPLICATION SOURCE TO) (?:MASTER_LOG_FILE|SOURCE_LOG_FILE)='([^']+)'" | Select-Object -First 1
    if ($posLine) {
        $binlogFile = $posLine.Matches[0].Groups[1].Value
        Write-BackupLog "Full backup taken at binlog position: $binlogFile"
        Set-LastBinlogFile -FileName $binlogFile
    }
    else {
        Write-BackupLog "Could not find a binlog position marker in the dump - daily incrementals will archive from the current binlog file forward instead of this exact point." "WARN"
    }
    $bytesProcessed += (Get-Item $dumpFile).Length

    Set-CurrentChainTag -Tag $chainTag

    if (-not (Test-ResticRepoInitialized -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH)) {
        Write-BackupLog "Initializing local restic repository at $($config.BACKUP_LOCAL_DEVICE_PATH)..."
        Invoke-Restic -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH -ResticArgs @("init") | Out-Null
    }
    Clear-ResticStaleLocks -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH

    $backupPaths = @($dumpFile)
    if ($config.BACKUP_UPLOADS_PATH -and (Test-Path $config.BACKUP_UPLOADS_PATH)) { $backupPaths += $config.BACKUP_UPLOADS_PATH }

    Write-BackupLog "Snapshotting to local repository..."
    Invoke-Restic -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH `
        -ResticArgs (@("backup") + $backupPaths + @("--tag", $chainTag, "--tag", "weekly-full")) | Out-Null

    $latest = (Invoke-Restic -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH -ResticArgs @("snapshots", "--json") | Out-String | ConvertFrom-Json) | Select-Object -Last 1
    $snapshotIdLocal = $latest.short_id
    $localSuccess = $true
    Write-BackupLog "Local weekly full complete: snapshot $snapshotIdLocal"

    Remove-Item $dumpFile -Force -ErrorAction SilentlyContinue

    if ($config.BACKUP_S3_BUCKET) {
        try {
            $cloudRepo = "s3:$($config.BACKUP_S3_ENDPOINT)/$($config.BACKUP_S3_BUCKET)"
            if (-not (Test-ResticRepoInitialized -Config $config -Repository $cloudRepo -IsCloud)) {
                Write-BackupLog "Initializing cloud restic repository..."
                Invoke-Restic -Config $config -Repository $cloudRepo -ResticArgs @("init") -IsCloud | Out-Null
            }
            Clear-ResticStaleLocks -Config $config -Repository $cloudRepo -IsCloud
            $passwordFile = Join-Path $config.BACKUP_SECRETS_DIR "restic-password.txt"
            Invoke-WithRetry -MaxAttempts 3 -DelaySeconds 15 -Action {
                Invoke-Restic -Config $config -Repository $cloudRepo -IsCloud `
                    -ResticArgs @("copy", "--from-repo", $config.BACKUP_LOCAL_DEVICE_PATH, "--from-password-file", $passwordFile, $snapshotIdLocal) | Out-Null
            }
            $cloudLatest = (Invoke-Restic -Config $config -Repository $cloudRepo -ResticArgs @("snapshots", "--json") -IsCloud | Out-String | ConvertFrom-Json) | Select-Object -Last 1
            $snapshotIdCloud = $cloudLatest.short_id
            $cloudSuccess = $true
            Write-BackupLog "Cloud copy complete: snapshot $snapshotIdCloud"

            Invoke-BackupRetention -Config $config -Repository $cloudRepo -RetentionDays ([int]$config.BACKUP_RETENTION_CLOUD_DAYS) -IsCloud
        }
        catch {
            $cloudSuccess = $false
            Write-BackupLog "Cloud copy failed (local backup is still safe): $($_.Exception.Message)" "ERROR"
        }
    }
    else {
        Write-BackupLog "BACKUP_S3_BUCKET not configured - cloud copy skipped (pending real cloud infrastructure, see runbook)." "WARN"
    }

    Invoke-BackupRetention -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH -RetentionDays ([int]$config.BACKUP_RETENTION_LOCAL_DAYS)
}
catch {
    $errorMessage = $_.Exception.Message
    Write-BackupLog "Weekly full backup FAILED: $errorMessage" "ERROR"
}
finally {
    Exit-BackupLock -LockFile $lock
    Send-BackupJobReport -Config $config -Report @{
        jobType         = "WeeklyFull"
        trigger         = $Trigger
        startedAt       = $startedAt.ToUniversalTime().ToString("o")
        completedAt     = (Get-Date).ToUniversalTime().ToString("o")
        localSuccess    = $localSuccess
        cloudSuccess    = $cloudSuccess
        snapshotIdLocal = $snapshotIdLocal
        snapshotIdCloud = $snapshotIdCloud
        fullChainTag    = $chainTag
        binlogFileStart = $binlogFile
        bytesProcessed  = $bytesProcessed
        errorMessage    = $errorMessage
        hostName        = $env:COMPUTERNAME
    }
    # Explicit exit code - never inherited from whatever native command
    # happened to run last (e.g. a purely-informational verification query),
    # which is exactly what produced a false-failure exit code in testing.
    if ($localSuccess) { exit 0 } else { exit 1 }
}
