<#
  Shared helpers for every ConstructIQ backup/restore script. Dot-sourced,
  never run directly: . "$PSScriptRoot\Common.ps1"

  Written for Windows PowerShell 5.1 (.NET Framework) deliberately - no
  RandomNumberGenerator.Fill, no ??/?./ternary operators, no here-string
  interpolation tricks that only work in PowerShell 7+.
#>

$script:BackupRoot = Split-Path $PSScriptRoot -Parent   # backend\backup
$script:LogDir      = Join-Path $BackupRoot "logs"
$script:StateDir    = Join-Path $BackupRoot "state"
$script:LockDir     = Join-Path $BackupRoot "state"

foreach ($dir in @($LogDir, $StateDir)) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

function Write-BackupLog {
    param([Parameter(Mandatory)][string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    $logFile = Join-Path $LogDir ("backup-{0}.log" -f (Get-Date -Format "yyyy-MM"))
    Add-Content -Path $logFile -Value $line
}

# Reads backend\backup\backup.env (KEY=VALUE per line, # comments allowed) if
# present, then layers real process environment variables on top (so a
# Task Scheduler action that does set real env vars still wins). Returns a
# hashtable - never mutates $env: itself, so nothing here leaks into other
# processes.
function Get-BackupConfig {
    $envFile = Join-Path $BackupRoot "backup.env"
    $config = @{
        DB_HOST                    = "localhost"
        DB_PORT                    = "3306"
        DB_NAME                    = "constructiq"
        DB_USER                    = "root"
        BACKUP_MYSQL_USER          = "constructiq_backup"
        BACKUP_SECRETS_DIR         = Join-Path $BackupRoot "secrets"
        BACKUP_LOCAL_DEVICE_PATH   = Join-Path $BackupRoot "local-repo"   # DEV DEFAULT ONLY - see runbook step 3
        BACKUP_STAGING_DIR         = Join-Path $BackupRoot "staging"
        BACKUP_UPLOADS_PATH        = Resolve-Path (Join-Path $BackupRoot "..\ConstructIQ.API\wwwroot\uploads") -ErrorAction SilentlyContinue
        BACKUP_S3_ENDPOINT         = ""
        BACKUP_S3_BUCKET           = ""
        BACKUP_API_URL             = "http://localhost:5000/api/v1/system/backup-jobs/report"
        BACKUP_RETENTION_LOCAL_DAYS = "30"
        BACKUP_RETENTION_CLOUD_DAYS = "90"
        BACKUP_TIMEZONE            = "Asia/Manila"
        MYSQL_BIN_DIR              = "C:\Program Files\MySQL\MySQL Server 8.0\bin"
    }

    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            $trimmed = $_.Trim()
            if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { return }
            $idx = $trimmed.IndexOf("=")
            if ($idx -lt 1) { return }
            $key = $trimmed.Substring(0, $idx).Trim()
            $val = $trimmed.Substring($idx + 1).Trim()
            $config[$key] = $val
        }
    }

    foreach ($key in @($config.Keys | ForEach-Object { $_ })) {
        $envVal = [Environment]::GetEnvironmentVariable($key)
        if ($envVal) { $config[$key] = $envVal }
    }

    return $config
}

function Get-BackupSecret {
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Name)
    $path = Join-Path $Config.BACKUP_SECRETS_DIR $Name
    if (-not (Test-Path $path)) { throw "Missing secret file: $path - run the setup scripts in docs/backup-runbook.md first." }
    return (Get-Content $path -Raw).Trim()
}

function Get-ResticExe {
    $cmd = Get-Command restic -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $wingetPath = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\restic.restic_*\restic_*_windows_amd64.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wingetPath) { return $wingetPath.FullName }
    throw "restic not found. Install it: winget install --id restic.restic -e"
}

# Runs restic against either the local or cloud repository, scoping all
# restic-related environment variables to just this call (set, run, remove -
# mirrors this codebase's existing MYSQL_PWD-scoping convention). Returns
# the captured stdout lines; throws on a non-zero exit code.
function Invoke-Restic {
    param(
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][string[]]$ResticArgs,
        [switch]$IsCloud
    )
    $resticExe = Get-ResticExe
    $password = Get-BackupSecret -Config $Config -Name "restic-password.txt"
    $env:RESTIC_PASSWORD = $password
    $env:RESTIC_REPOSITORY = $Repository
    if ($IsCloud) {
        # Credentials, not endpoint/bucket - kept out of backup.env entirely
        # (backup.env lives inside this repo, which is itself under OneDrive)
        # and read from BACKUP_SECRETS_DIR alongside the other three secret
        # files, same treatment as restic-password.txt.
        $env:AWS_ACCESS_KEY_ID = Get-BackupSecret -Config $Config -Name "b2-key-id.txt"
        $env:AWS_SECRET_ACCESS_KEY = Get-BackupSecret -Config $Config -Name "b2-application-key.txt"
    }
    try {
        $output = & $resticExe @ResticArgs 2>&1
        if ($LASTEXITCODE -ne 0) {
            # restic sets a non-zero exit even for errors it already logged as
            # "ignoring" (e.g. failing to reset a reconstructed directory's
            # mtime under a cloud-synced folder like OneDrive) - real data was
            # still restored/backed up correctly in that case. Only treat
            # THIS exact known-benign pattern as non-fatal; anything else
            # still throws.
            $problemLines = $output | Where-Object { $_ -match '^(Fatal:|error:)' -and $_ -notmatch 'There were \d+ errors' }
            $onlyTimestampNoise = ($output | Where-Object { $_ -match 'ignoring error for .*failed to restore timestamp' }).Count -gt 0 `
                -and ($output -join "|") -notmatch 'Summary: Restored 0 '
            if ($problemLines.Count -eq 0 -and $onlyTimestampNoise) {
                Write-BackupLog "restic reported non-fatal timestamp-restore warnings only (common on cloud-synced folders like OneDrive) - continuing." "WARN"
                return $output
            }
            $joined = $output -join [Environment]::NewLine
            throw "restic exited with code $LASTEXITCODE (args: $($ResticArgs -join ' ')): $joined"
        }
        return $output
    }
    finally {
        Remove-Item Env:\RESTIC_PASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:\RESTIC_REPOSITORY -ErrorAction SilentlyContinue
        if ($IsCloud) {
            Remove-Item Env:\AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
            Remove-Item Env:\AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
        }
    }
}

# Releases any restic repository locks left behind by a killed/crashed
# process (restic writes a lock object into the repo itself for the
# duration of most operations and normally removes it on exit - a process
# that dies mid-run leaves it behind, blocking every future run against
# that repo with "unable to create lock"). Safe to call before every job:
# `restic unlock` refuses to remove a lock that's still genuinely held by
# a running process on this or another host.
function Clear-ResticStaleLocks {
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Repository, [switch]$IsCloud)
    try {
        Invoke-Restic -Config $Config -Repository $Repository -ResticArgs @("unlock") -IsCloud:$IsCloud | Out-Null
    }
    catch {
        Write-BackupLog "restic unlock reported an issue (non-fatal, continuing): $($_.Exception.Message)" "WARN"
    }
}

# True once the repository has been `restic init`-ed (config file present).
function Test-ResticRepoInitialized {
    param([Parameter(Mandatory)][hashtable]$Config, [Parameter(Mandatory)][string]$Repository, [switch]$IsCloud)
    try {
        Invoke-Restic -Config $Config -Repository $Repository -ResticArgs @("cat", "config") -IsCloud:$IsCloud | Out-Null
        return $true
    }
    catch { return $false }
}

# Whole-chain retention: every snapshot is tagged with the full-id of the
# weekly full it belongs to (the full itself, plus every daily incremental
# taken before the next full). A chain is only pruned once its WeeklyFull
# snapshot is older than $RetentionDays - never a lone full whose dependent
# incrementals are still needed, and never an incremental orphaned from its
# full. restic's own --keep-* policies operate per-snapshot, not per-chain,
# so this is done explicitly rather than reached for a policy flag that
# doesn't actually express this requirement.
function Invoke-BackupRetention {
    param(
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][int]$RetentionDays,
        [switch]$IsCloud
    )
    $raw = Invoke-Restic -Config $Config -Repository $Repository -ResticArgs @("snapshots", "--json") -IsCloud:$IsCloud
    $snapshots = $raw | Out-String | ConvertFrom-Json
    if (-not $snapshots) { return }

    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    $chains = $snapshots | Group-Object { ($_.tags | Where-Object { $_ -like "full-id:*" } | Select-Object -First 1) }

    foreach ($chain in $chains) {
        if (-not $chain.Name) { continue } # untagged snapshot - leave alone
        $fullSnap = $chain.Group | Where-Object { $_.tags -contains "weekly-full" } | Select-Object -First 1
        if (-not $fullSnap) { continue } # no full yet for this chain - don't guess, leave it
        if ([DateTime]$fullSnap.time -ge $cutoff) { continue } # chain still within retention

        $idsToForget = $chain.Group | ForEach-Object { $_.short_id }
        Write-BackupLog "Retention: pruning chain $($chain.Name) ($($idsToForget.Count) snapshot(s), full dated $($fullSnap.time))."
        Invoke-Restic -Config $Config -Repository $Repository -ResticArgs (@("forget") + $idsToForget + @("--prune")) -IsCloud:$IsCloud | Out-Null
    }
}

# Shared core of Restore-Local.ps1 and Restore-Cloud.ps1 - restores a full
# backup chain (WeeklyFull dump + every DailyIncremental's binlogs, replayed
# in order) from the given repository into a NEW, isolated database and
# uploads folder. Never touches the live database/uploads. Uses the app's
# own admin DB credential (DB_USER/DB_PASSWORD via $env:DB_PASSWORD), not
# the backup-writer identity, which deliberately cannot CREATE DATABASE or
# write data - restore is an administrative action, backup-writing is not.
function Invoke-BackupRestore {
    param(
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][string]$TargetDbName,
        [Parameter(Mandatory)][string]$TargetUploadsPath,
        [string]$ChainTag,
        [switch]$IsCloud
    )

    if ($TargetDbName -ieq $Config.DB_NAME) { throw "Refusing to restore over the live database '$($Config.DB_NAME)'. Choose a different target database name." }
    if ($Config.BACKUP_UPLOADS_PATH) {
        $liveResolved = (Resolve-Path $Config.BACKUP_UPLOADS_PATH -ErrorAction SilentlyContinue)
        $targetResolved = (Resolve-Path $TargetUploadsPath -ErrorAction SilentlyContinue)
        if ($liveResolved -and $targetResolved -and ($liveResolved.Path -eq $targetResolved.Path)) {
            throw "Refusing to restore over the live uploads folder. Choose a different target uploads path."
        }
    }

    $rootPassword = $env:DB_PASSWORD
    if (-not $rootPassword) { throw "Set `$env:DB_PASSWORD (the app's own admin DB credential) before restoring." }

    $restoreWorkDir = Join-Path $Config.BACKUP_STAGING_DIR ("restore-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Path $restoreWorkDir -Force | Out-Null

    try {
        Clear-ResticStaleLocks -Config $Config -Repository $Repository -IsCloud:$IsCloud
        $snapshots = (Invoke-Restic -Config $Config -Repository $Repository -ResticArgs @("snapshots", "--json") -IsCloud:$IsCloud) | Out-String | ConvertFrom-Json
        if (-not $ChainTag) {
            $latestFull = $snapshots | Where-Object { $_.tags -contains "weekly-full" } | Sort-Object time | Select-Object -Last 1
            if (-not $latestFull) { throw "No WeeklyFull snapshot found in this repository." }
            $ChainTag = $latestFull.tags | Where-Object { $_ -like "full-id:*" } | Select-Object -First 1
        }
        Write-BackupLog "Restoring chain: $ChainTag (repository: $Repository)"

        $chainSnapshots = $snapshots | Where-Object { $_.tags -contains $ChainTag } | Sort-Object time
        $fullSnap = $chainSnapshots | Where-Object { $_.tags -contains "weekly-full" } | Select-Object -First 1
        $incrementalSnaps = $chainSnapshots | Where-Object { $_.tags -contains "daily-incremental" }
        if (-not $fullSnap) { throw "Chain '$ChainTag' has no WeeklyFull snapshot in this repository." }

        $mysqlExe = Get-MySqlExe -Config $Config -Name "mysql.exe"

        $fullRestoreDir = Join-Path $restoreWorkDir "full"
        Invoke-Restic -Config $Config -Repository $Repository -IsCloud:$IsCloud -ResticArgs @("restore", $fullSnap.short_id, "--target", $fullRestoreDir) | Out-Null
        $dumpFile = Get-ChildItem -Path $fullRestoreDir -Filter "full-*.sql" -Recurse | Select-Object -First 1
        if (-not $dumpFile) { throw "Restored snapshot $($fullSnap.short_id) did not contain a full-*.sql dump file." }

        # The dump's own --source-data=2 comment records EXACTLY which
        # binlog file+position it was taken at. Replaying a binlog file
        # from byte 0 would re-execute everything already reflected in the
        # dump (e.g. a prior ALTER TABLE), so the FIRST archived file that
        # matches this checkpoint filename must be replayed starting from
        # this position - every later file replays from its own start.
        $checkpointFile = $null
        $checkpointPos = $null
        $posLine = Select-String -Path $dumpFile.FullName -Pattern "^-- CHANGE (?:MASTER TO|REPLICATION SOURCE TO) (?:MASTER_LOG_FILE|SOURCE_LOG_FILE)='([^']+)', (?:MASTER_LOG_POS|SOURCE_LOG_POS)=(\d+)" | Select-Object -First 1
        if ($posLine) {
            $checkpointFile = $posLine.Matches[0].Groups[1].Value
            $checkpointPos = $posLine.Matches[0].Groups[2].Value
            Write-BackupLog "Dump checkpoint: $checkpointFile @ $checkpointPos"
        }

        $env:MYSQL_PWD = $rootPassword
        try {
            Write-BackupLog "Creating database '$TargetDbName' and loading the full dump..."
            Invoke-ExeOrThrow -Exe $mysqlExe -ExeArgs @("-h", $Config.DB_HOST, "-P", $Config.DB_PORT, "-u", $Config.DB_USER, "-e", "CREATE DATABASE IF NOT EXISTS ``$TargetDbName``;") | Out-Null
            Invoke-ExeOrThrow -Exe $mysqlExe -ExeArgs @("-h", $Config.DB_HOST, "-P", $Config.DB_PORT, "-u", $Config.DB_USER, $TargetDbName) -InputText (Get-Content $dumpFile.FullName -Raw) | Out-Null

            foreach ($inc in $incrementalSnaps) {
                Write-BackupLog "Restoring and replaying incremental snapshot $($inc.short_id) ($($inc.time))..."
                $incDir = Join-Path $restoreWorkDir "inc-$($inc.short_id)"
                Invoke-Restic -Config $Config -Repository $Repository -IsCloud:$IsCloud -ResticArgs @("restore", $inc.short_id, "--target", $incDir) | Out-Null
                $binlogFiles = Get-ChildItem -Path $incDir -Filter "*-bin.*" -Recurse | Sort-Object Name
                foreach ($bf in $binlogFiles) {
                    $mysqlbinlogExe = Get-MySqlExe -Config $Config -Name "mysqlbinlog.exe"
                    # ROW-format binlog events hardcode the ORIGINAL database
                    # name (Config.DB_NAME) inside each event - without
                    # --rewrite-db, replay silently re-applies to that same
                    # live database regardless of which DB the mysql client
                    # is connected to, which is exactly the "never touch the
                    # live database" rule this script exists to enforce.
                    # (Tested and confirmed: mysqlbinlog's --database filter
                    # combined with --rewrite-db drops every event, even ones
                    # from the matching database - a real mysqlbinlog
                    # limitation, not usable together. --rewrite-db alone is
                    # what protects the live TARGET database, which is the
                    # primary guarantee this script makes. KNOWN LIMITATION:
                    # on a MySQL instance hosting more than just this app's
                    # database, the archived binlog is server-wide, so a
                    # restore also replays any OTHER database's changes from
                    # that window against ITS OWN live name, unfiltered. Not
                    # a concern for a single-database-per-instance deployment
                    # (this app's actual setup) but is not silently patched
                    # over - see docs/backup-runbook.md.
                    $binlogArgs = @("--rewrite-db=$($Config.DB_NAME)->$TargetDbName", $bf.FullName)
                    if ($checkpointFile -and $bf.Name -eq $checkpointFile) {
                        Write-BackupLog "Replaying $($bf.Name) from checkpoint position $checkpointPos (skipping events already in the full dump)."
                        $binlogArgs = @("--start-position=$checkpointPos") + $binlogArgs
                    }
                    $sqlText = Invoke-ExeOrThrow -Exe $mysqlbinlogExe -ExeArgs $binlogArgs
                    Invoke-ExeOrThrow -Exe $mysqlExe -ExeArgs @("-h", $Config.DB_HOST, "-P", $Config.DB_PORT, "-u", $Config.DB_USER, $TargetDbName) -InputText ($sqlText -join [Environment]::NewLine) | Out-Null
                }
            }
        }
        finally { Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue }

        $latestInChain = $chainSnapshots | Select-Object -Last 1
        if ($Config.BACKUP_UPLOADS_PATH) {
            # Every snapshot in the chain already restored the FULL uploads
            # tree (both WeeklyFull and DailyIncremental always include it) -
            # reuse whichever directory the loop above (or the full-dump
            # restore) already populated instead of a second restic call.
            # restic's --include path matching proved unreliable against
            # Windows absolute paths in testing, so this avoids it entirely.
            $sourceRestoreDir = if ($latestInChain.short_id -eq $fullSnap.short_id) { $fullRestoreDir } else { Join-Path $restoreWorkDir "inc-$($latestInChain.short_id)" }
            Write-BackupLog "Restoring uploads from snapshot $($latestInChain.short_id) (already-restored copy at $sourceRestoreDir)..."
            if (-not (Test-Path $TargetUploadsPath)) { New-Item -ItemType Directory -Path $TargetUploadsPath -Force | Out-Null }
            $restoredUploadsRoot = Get-ChildItem -Path $sourceRestoreDir -Directory -Recurse -Filter "uploads" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($restoredUploadsRoot) {
                # robocopy, not Copy-Item: the reconstructed source path
                # (restic replays the full original absolute path under the
                # restore target) easily exceeds legacy MAX_PATH once nested
                # under this repo's own already-long path, which Copy-Item
                # cannot handle but robocopy does.
                & robocopy $restoredUploadsRoot.FullName $TargetUploadsPath /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
                if ($LASTEXITCODE -ge 8) { throw "robocopy failed copying uploads (exit code $LASTEXITCODE)." }
            }
            else {
                Write-BackupLog "No 'uploads' folder found in the restored snapshot content - nothing to copy." "WARN"
            }
        }

        # Schema-agnostic sanity check (never assumes a specific table name):
        # compares how many tables exist in the live vs. restored database.
        # Purely informational logging - never throws, so a query hiccup
        # here can't be mistaken for the restore itself having failed.
        $env:MYSQL_PWD = $rootPassword
        try {
            $liveTableCount = & $mysqlExe -h $Config.DB_HOST -P $Config.DB_PORT -u $Config.DB_USER -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$($Config.DB_NAME)';" 2>$null
            $restoredTableCount = & $mysqlExe -h $Config.DB_HOST -P $Config.DB_PORT -u $Config.DB_USER -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TargetDbName';" 2>$null
            Write-BackupLog "Verification: live DB has $liveTableCount table(s), restored DB has $restoredTableCount table(s)."
        }
        catch { Write-BackupLog "Verification query failed (non-fatal): $($_.Exception.Message)" "WARN" }
        finally { Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue; $global:LASTEXITCODE = 0 }

        Write-BackupLog "=== Restore complete: database '$TargetDbName', uploads at '$TargetUploadsPath' ==="
        return $ChainTag
    }
    finally {
        Remove-Item $restoreWorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Runs an .exe and throws with the captured output on failure - used for the
# mysql/mysqldump/mysqlbinlog calls so a failure is debuggable instead of
# silently swallowed by piping to Out-Null.
function Invoke-ExeOrThrow {
    param([Parameter(Mandatory)][string]$Exe, [Parameter(Mandatory)][string[]]$ExeArgs, [string]$InputText)
    if ($null -ne $InputText) {
        $output = $InputText | & $Exe @ExeArgs 2>&1
    } else {
        $output = & $Exe @ExeArgs 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        $joined = $output -join [Environment]::NewLine
        throw "$(Split-Path $Exe -Leaf) exited with code ${LASTEXITCODE}: $joined"
    }
    return $output
}

function Get-MySqlExe {
    param([Parameter(Mandatory)][hashtable]$Config, [string]$Name = "mysql.exe")
    $path = Join-Path $Config.MYSQL_BIN_DIR $Name
    if (-not (Test-Path $path)) { throw "$Name not found at $path - set MYSQL_BIN_DIR in backup.env." }
    return $path
}

# Prevents overlapping backup/restore/prune runs (requirement: "A lock
# preventing overlapping backup, restore, and pruning operations"). A stale
# lock (holder process no longer running) is treated as free rather than
# blocking forever.
function Enter-BackupLock {
    param([Parameter(Mandatory)][string]$LockName)
    $lockFile = Join-Path $LockDir "$LockName.lock"
    if (Test-Path $lockFile) {
        $holderPid = (Get-Content $lockFile -Raw).Trim()
        $stillRunning = $false
        if ($holderPid -match '^\d+$') {
            $proc = Get-Process -Id ([int]$holderPid) -ErrorAction SilentlyContinue
            if ($proc) { $stillRunning = $true }
        }
        if ($stillRunning) {
            throw "Another '$LockName' job is already running (pid $holderPid). Overlapping runs are rejected by design."
        }
        Write-BackupLog "Removing stale lock for '$LockName' (pid $holderPid no longer running)." "WARN"
        Remove-Item $lockFile -Force
    }
    Set-Content -Path $lockFile -Value $PID -NoNewline
    return $lockFile
}

function Exit-BackupLock {
    param([Parameter(Mandatory)][string]$LockFile)
    Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
}

# Bounded retry for transient cloud-upload failures - never retries forever.
function Invoke-WithRetry {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [int]$MaxAttempts = 3,
        [int]$DelaySeconds = 10
    )
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try { return & $Action }
        catch {
            if ($attempt -eq $MaxAttempts) { throw }
            Write-BackupLog "Attempt $attempt/$MaxAttempts failed: $($_.Exception.Message). Retrying in $DelaySeconds s." "WARN"
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

function Test-DiskSpaceOrThrow {
    param([Parameter(Mandatory)][string]$Path, [long]$MinimumFreeBytes = 500MB)
    if ($Path -notmatch '^[A-Za-z]:') { return } # UNC/relative path - skip, can't resolve a PSDrive letter
    $drive = Get-PSDrive -Name $Path.Substring(0,1) -ErrorAction SilentlyContinue
    if ($drive -and $drive.Free -lt $MinimumFreeBytes) {
        throw "Only $([math]::Round($drive.Free/1MB,1)) MB free at $Path - need at least $([math]::Round($MinimumFreeBytes/1MB,1)) MB."
    }
}

# Reports a job outcome to ConstructIQ.API. A reporting failure is logged but
# never crashes the caller - the backup itself already happened or didn't;
# losing the status row shouldn't compound that.
function Send-BackupJobReport {
    param(
        [Parameter(Mandatory)][hashtable]$Config,
        [Parameter(Mandatory)][hashtable]$Report
    )
    try {
        $token = Get-BackupSecret -Config $Config -Name "backup-report-token.txt"
        $body = $Report | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Method Post -Uri $Config.BACKUP_API_URL `
            -Headers @{ "X-Backup-Report-Token" = $token } `
            -ContentType "application/json" -Body $body -TimeoutSec 30 | Out-Null
        Write-BackupLog "Reported job outcome to $($Config.BACKUP_API_URL)."
    }
    catch {
        Write-BackupLog "Could not report job outcome to the API: $($_.Exception.Message)" "WARN"
    }
}

function New-FullChainTag {
    return "full-id:{0}" -f (Get-Date -Format "yyyyMMddTHHmmssZ")
}

$script:ChainStateFile = Join-Path $StateDir "current-chain.txt"

function Set-CurrentChainTag {
    param([Parameter(Mandatory)][string]$Tag)
    Set-Content -Path $ChainStateFile -Value $Tag -NoNewline
}

function Get-CurrentChainTag {
    if (Test-Path $ChainStateFile) { return (Get-Content $ChainStateFile -Raw).Trim() }
    return $null
}

$script:BinlogStateFile = Join-Path $StateDir "last-binlog-position.txt"

function Set-LastBinlogFile {
    param([Parameter(Mandatory)][string]$FileName)
    Set-Content -Path $BinlogStateFile -Value $FileName -NoNewline
}

function Get-LastBinlogFile {
    if (Test-Path $BinlogStateFile) { return (Get-Content $BinlogStateFile -Raw).Trim() }
    return $null
}
