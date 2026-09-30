<#
.SYNOPSIS
  Daily incremental backup: archives whatever MySQL binary log files were
  written since the last checkpoint, plus a restic snapshot of any changed
  files under wwwroot/uploads.

.DESCRIPTION
  This is the REAL incremental mechanism for the database - MySQL's own
  binary log, not a deduplicated copy of a dump file. Binlogs are fetched
  over the MySQL replication protocol (mysqlbinlog --read-from-remote-server
  --raw) using the constructiq_backup identity's REPLICATION SLAVE grant, so
  this never needs OS filesystem access to MySQL's datadir. Restoring any
  point covered by these files requires the most recent WeeklyFull plus
  every incremental up to that point, replayed in order - "full backup plus
  log-based recovery," not a standalone backup.

  Requires Backup-Weekly.ps1 to have run at least once (it establishes the
  current chain tag and the starting binlog position).
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
$bytesProcessed = 0
$binlogFrom = $null
$binlogTo = $null

try {
    Write-BackupLog "=== Daily incremental backup starting (trigger=$Trigger) ==="

    $chainTag = Get-CurrentChainTag
    if (-not $chainTag) {
        throw "No weekly full backup has run yet on this host - run Backup-Weekly.ps1 first (see docs/backup-runbook.md)."
    }

    if (-not (Test-Path $config.BACKUP_STAGING_DIR)) { New-Item -ItemType Directory -Path $config.BACKUP_STAGING_DIR -Force | Out-Null }
    Test-DiskSpaceOrThrow -Path $config.BACKUP_STAGING_DIR
    Test-DiskSpaceOrThrow -Path $config.BACKUP_LOCAL_DEVICE_PATH

    $mysqlExe = Get-MySqlExe -Config $config -Name "mysql.exe"
    $mysqlBinlogExe = Get-MySqlExe -Config $config -Name "mysqlbinlog.exe"
    $mysqlPwd = Get-BackupSecret -Config $config -Name "mysql-backup-user-password.txt"

    $env:MYSQL_PWD = $mysqlPwd
    try {
        Write-BackupLog "Rotating to a fresh binlog file (FLUSH BINARY LOGS)..."
        & $mysqlExe -h $config.DB_HOST -P $config.DB_PORT -u $config.BACKUP_MYSQL_USER -e "FLUSH BINARY LOGS;" 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "FLUSH BINARY LOGS failed (exit $LASTEXITCODE) - is RELOAD granted to constructiq_backup?" }

        $rawList = & $mysqlExe -h $config.DB_HOST -P $config.DB_PORT -u $config.BACKUP_MYSQL_USER -N -e "SHOW BINARY LOGS;" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "SHOW BINARY LOGS failed (exit $LASTEXITCODE)" }
    }
    finally { Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue }

    # Each line is "filename<TAB>size<TAB>encrypted" (-N drops the header).
    $allFiles = $rawList | ForEach-Object { ($_ -split "`t")[0] } | Where-Object { $_ }
    if ($allFiles.Count -eq 0) { throw "SHOW BINARY LOGS returned no files - is binary logging still enabled?" }

    # The last (highest-numbered) file is the one just rotated into and is
    # actively being written right now - never archive it; it becomes
    # eligible on a future run once something rotates past it.
    $archivable = $allFiles[0..($allFiles.Count - 2)]

    $lastArchived = Get-LastBinlogFile
    $candidates = @()
    if ($lastArchived -and ($archivable -contains $lastArchived)) {
        $startIdx = [array]::IndexOf($archivable, $lastArchived) + 1
        $candidates = $archivable[$startIdx..($archivable.Count - 1)]
    }
    elseif ($lastArchived) {
        Write-BackupLog "Checkpoint '$lastArchived' is no longer among this server's binary logs - it was likely purged before being archived. Treating ALL currently available closed binlogs as candidates; recovery across the gap will require a fresh WeeklyFull to fully close it." "WARN"
        $candidates = $archivable
    }
    else {
        $candidates = $archivable
    }

    if ($candidates.Count -eq 0) {
        Write-BackupLog "No new closed binlog files since the last checkpoint - nothing to archive today."
        $localSuccess = $true
    }
    else {
        $binlogFrom = $candidates[0]
        $binlogTo = $candidates[-1]
        Write-BackupLog "Archiving $($candidates.Count) binlog file(s): $binlogFrom .. $binlogTo"

        $env:MYSQL_PWD = $mysqlPwd
        try {
            & $mysqlBinlogExe -R --raw -r "$($config.BACKUP_STAGING_DIR)\" `
                --host=$($config.DB_HOST) --port=$($config.DB_PORT) --user=$($config.BACKUP_MYSQL_USER) `
                @candidates 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "mysqlbinlog exited with code $LASTEXITCODE" }
        }
        finally { Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue }

        $stagedFiles = $candidates | ForEach-Object { Join-Path $config.BACKUP_STAGING_DIR $_ }
        $bytesProcessed = ($stagedFiles | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum

        if (-not (Test-ResticRepoInitialized -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH)) {
            throw "Local restic repository not initialized - run Backup-Weekly.ps1 first."
        }
        Clear-ResticStaleLocks -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH

        $backupPaths = @($stagedFiles)
        if ($config.BACKUP_UPLOADS_PATH -and (Test-Path $config.BACKUP_UPLOADS_PATH)) { $backupPaths += $config.BACKUP_UPLOADS_PATH }

        Write-BackupLog "Snapshotting to local repository..."
        Invoke-Restic -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH `
            -ResticArgs (@("backup") + $backupPaths + @("--tag", $chainTag, "--tag", "daily-incremental")) | Out-Null

        $latest = (Invoke-Restic -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH -ResticArgs @("snapshots", "--json") | Out-String | ConvertFrom-Json) | Select-Object -Last 1
        $snapshotIdLocal = $latest.short_id
        $localSuccess = $true
        Write-BackupLog "Local daily incremental complete: snapshot $snapshotIdLocal"

        Set-LastBinlogFile -FileName $binlogTo
        $stagedFiles | Remove-Item -Force -ErrorAction SilentlyContinue

        if ($config.BACKUP_S3_BUCKET) {
            try {
                $cloudRepo = "s3:$($config.BACKUP_S3_ENDPOINT)/$($config.BACKUP_S3_BUCKET)"
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
            }
            catch {
                $cloudSuccess = $false
                Write-BackupLog "Cloud copy failed (local backup is still safe): $($_.Exception.Message)" "ERROR"
            }
        }
        else {
            Write-BackupLog "BACKUP_S3_BUCKET not configured - cloud copy skipped (pending real cloud infrastructure, see runbook)." "WARN"
        }
    }
}
catch {
    $errorMessage = $_.Exception.Message
    Write-BackupLog "Daily incremental backup FAILED: $errorMessage" "ERROR"
}
finally {
    Exit-BackupLock -LockFile $lock
    Send-BackupJobReport -Config $config -Report @{
        jobType         = "DailyIncremental"
        trigger         = $Trigger
        startedAt       = $startedAt.ToUniversalTime().ToString("o")
        completedAt     = (Get-Date).ToUniversalTime().ToString("o")
        localSuccess    = $localSuccess
        cloudSuccess    = $cloudSuccess
        snapshotIdLocal = $snapshotIdLocal
        snapshotIdCloud = $snapshotIdCloud
        fullChainTag    = (Get-CurrentChainTag)
        binlogFileStart = $binlogFrom
        binlogFileEnd   = $binlogTo
        bytesProcessed  = $bytesProcessed
        errorMessage    = $errorMessage
        hostName        = $env:COMPUTERNAME
    }
    if ($localSuccess) { exit 0 } else { exit 1 }
}
