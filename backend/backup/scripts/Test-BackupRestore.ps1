<#
.SYNOPSIS
  Automated verification harness for the backup/restore arrangement. Runs
  the REAL Backup-Weekly.ps1 / Backup-Daily.ps1 / Restore-Local.ps1 scripts
  (not a reimplementation) against entirely disposable resources - a
  scratch database, a scratch local-repo path, and a scratch uploads
  folder - so nothing here ever touches the real 'constructiq' database,
  the real local-repo, or the real wwwroot/uploads.

.DESCRIPTION
  Mirrors the scratch-database-per-run pattern already used by
  ConstructIQ.SecurityChecks / ConstructIQ.Tests. Requires
  $env:DB_PASSWORD (the app's own admin DB credential) to be set before
  running, same as the restore scripts.
#>
param([switch]$SkipCloudUnavailableTest)

. "$PSScriptRoot\Common.ps1"

$results = New-Object System.Collections.Generic.List[object]
function Assert-True { param([bool]$Condition, [string]$Name)
    if ($Condition) { $results.Add(@{ Name = $Name; Pass = $true }); Write-Host "  PASS: $Name" -ForegroundColor Green }
    else            { $results.Add(@{ Name = $Name; Pass = $false }); Write-Host "  FAIL: $Name" -ForegroundColor Red }
}

if (-not $env:DB_PASSWORD) { throw "Set `$env:DB_PASSWORD before running this test harness." }

$suffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$scratchDb = "ciq_backup_test_$suffix"
$scratchRepoRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "test-scratch\$suffix"
$scratchLocalRepo = Join-Path $scratchRepoRoot "local-repo"
$scratchUploads = Join-Path $scratchRepoRoot "uploads"
$scratchStaging = Join-Path $scratchRepoRoot "staging"
$scratchRestoreDb = "${scratchDb}_restore"
$scratchRestoreUploads = Join-Path $scratchRepoRoot "restore-uploads"

New-Item -ItemType Directory -Path $scratchUploads -Force | Out-Null
New-Item -ItemType Directory -Path $scratchStaging -Force | Out-Null

$rootPwd = $env:DB_PASSWORD
$mysqlExe = Get-MySqlExe -Config (Get-BackupConfig) -Name "mysql.exe"

function Invoke-Sql { param([string]$Sql, [string]$Database = "")
    $env:MYSQL_PWD = $rootPwd
    try {
        if ($Database) { & $mysqlExe -h localhost -u root $Database -e $Sql 2>&1 }
        else { & $mysqlExe -h localhost -u root -e $Sql 2>&1 }
    }
    finally { Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue }
}

# This test process's OWN Send-BackupJobReport calls would otherwise write
# real rows into the REAL constructiq.BackupJobRuns table on this SAME MySQL
# instance while the scratch tests run - and since a server-wide binlog
# archive isn't scoped to one database (a disclosed, real limitation - see
# Common.ps1's Invoke-BackupRestore), those rows would get swept into the
# SAME incremental window as the scratch DB's own changes and replayed
# against the live constructiq database during restore, tripping a
# duplicate-key error unrelated to what's actually being tested here.
# Redirecting reporting to an address that fails fast avoids that cross-
# contamination without weakening anything real - Send-BackupJobReport
# already tolerates report failures by design.
$realApiBase = (Get-BackupConfig).BACKUP_API_URL -replace "/backup-jobs/report$", ""
$env:BACKUP_API_URL = "http://127.0.0.1:1/unreachable-during-tests"

Write-Host "=== Test 1: Full backup + restore round-trip ===" -ForegroundColor Cyan
try {
    Invoke-Sql "CREATE DATABASE $scratchDb; CREATE TABLE $scratchDb.widgets (Id INT PRIMARY KEY, Name VARCHAR(50)); INSERT INTO $scratchDb.widgets VALUES (1,'alpha'),(2,'beta');"
    "dummy content A" | Set-Content (Join-Path $scratchUploads "file-a.txt")
    $hashBefore = (Get-FileHash (Join-Path $scratchUploads "file-a.txt") -Algorithm SHA256).Hash

    $env:DB_NAME = $scratchDb
    $env:BACKUP_LOCAL_DEVICE_PATH = $scratchLocalRepo
    $env:BACKUP_UPLOADS_PATH = $scratchUploads
    $env:BACKUP_STAGING_DIR = $scratchStaging
    # constructiq_backup's grants are ON *.* (global), so it already covers
    # this scratch database too - no need to swap credentials for the test.

    & "$PSScriptRoot\Backup-Weekly.ps1" -Trigger Manual | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Weekly full backup of scratch DB succeeds"

    & "$PSScriptRoot\Restore-Local.ps1" -TargetDbName $scratchRestoreDb -TargetUploadsPath $scratchRestoreUploads -Confirm | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Restore into isolated scratch database succeeds"

    $restoredRows = (Invoke-Sql "SELECT COUNT(*) FROM $scratchRestoreDb.widgets;" | Select-Object -Last 1)
    Assert-True ($restoredRows -eq "2") "Restored row count matches source (2 widgets)"

    $restoredFile = Join-Path $scratchRestoreUploads "file-a.txt"
    $hashAfter = if (Test-Path $restoredFile) { (Get-FileHash $restoredFile -Algorithm SHA256).Hash } else { $null }
    Assert-True ($hashAfter -eq $hashBefore) "Restored uploaded file hash matches source"
}
catch { Assert-True $false "Test 1 threw: $($_.Exception.Message)" }

Write-Host "`n=== Test 2: Incremental captures insert/update/delete ===" -ForegroundColor Cyan
try {
    Invoke-Sql "INSERT INTO $scratchDb.widgets VALUES (3,'gamma');" $scratchDb | Out-Null
    Invoke-Sql "UPDATE $scratchDb.widgets SET Name='beta2' WHERE Id=2;" $scratchDb | Out-Null
    Invoke-Sql "DELETE FROM $scratchDb.widgets WHERE Id=1;" $scratchDb | Out-Null
    "dummy content B" | Set-Content (Join-Path $scratchUploads "file-b.txt")

    & "$PSScriptRoot\Backup-Daily.ps1" -Trigger Manual | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Daily incremental backup succeeds"

    $restoreDb2 = "${scratchDb}_restore2"
    $restoreUploads2 = Join-Path $scratchRepoRoot "restore-uploads2"
    & "$PSScriptRoot\Restore-Local.ps1" -TargetDbName $restoreDb2 -TargetUploadsPath $restoreUploads2 -Confirm | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Restore after incremental succeeds"

    $rows = Invoke-Sql "SELECT Id, Name FROM $restoreDb2.widgets ORDER BY Id;"
    $rowsJoined = $rows -join "|"
    Assert-True ($rowsJoined -match "2\s*\|?\s*beta2" -or $rowsJoined -match "beta2") "Update captured (Id=2 renamed to beta2)"
    Assert-True ($rowsJoined -notmatch "\balpha\b") "Delete captured (Id=1 'alpha' no longer present)"
    Assert-True ($rowsJoined -match "gamma") "Insert captured (Id=3 'gamma' present)"
    Assert-True (Test-Path (Join-Path $restoreUploads2 "file-b.txt")) "New uploaded file captured by incremental"

    Invoke-Sql "DROP DATABASE IF EXISTS $restoreDb2;" | Out-Null
}
catch { Assert-True $false "Test 2 threw: $($_.Exception.Message)" }

Write-Host "`n=== Test 3: Wrong encryption key is rejected ===" -ForegroundColor Cyan
try {
    $realPasswordFile = Join-Path (Get-BackupConfig).BACKUP_SECRETS_DIR "restic-password.txt"
    $realPassword = (Get-Content $realPasswordFile -Raw).Trim()
    $resticExe = Get-ResticExe
    $env:RESTIC_PASSWORD = "definitely-the-wrong-password"
    $env:RESTIC_REPOSITORY = $scratchLocalRepo
    & $resticExe snapshots 2>&1 | Out-Null
    $wrongKeyExitCode = $LASTEXITCODE
    Remove-Item Env:\RESTIC_PASSWORD, Env:\RESTIC_REPOSITORY -ErrorAction SilentlyContinue
    Assert-True ($wrongKeyExitCode -ne 0) "restic refuses to open the repository with the wrong password"
}
catch { Assert-True $false "Test 3 threw: $($_.Exception.Message)" }

Write-Host "`n=== Test 4: Overlapping jobs are rejected ===" -ForegroundColor Cyan
try {
    $lock1 = Enter-BackupLock -LockName "test-overlap-$suffix"
    $overlapRejected = $false
    try { Enter-BackupLock -LockName "test-overlap-$suffix" | Out-Null }
    catch { $overlapRejected = $true }
    Assert-True $overlapRejected "A second lock attempt on the same job name is rejected while the first is held"
    Exit-BackupLock -LockFile $lock1
    $lock2 = Enter-BackupLock -LockName "test-overlap-$suffix"
    Assert-True (Test-Path $lock2) "Lock can be re-acquired after release"
    Exit-BackupLock -LockFile $lock2
}
catch { Assert-True $false "Test 4 threw: $($_.Exception.Message)" }

Write-Host "`n=== Test 5: Non-admin access to backup-jobs endpoints is denied ===" -ForegroundColor Cyan
try {
    try {
        Invoke-RestMethod -Uri "$realApiBase/backup-jobs/status" -Method Get -ErrorAction Stop | Out-Null
        Assert-True $false "Unauthenticated request to /backup-jobs/status should be rejected"
    }
    catch {
        $status = $_.Exception.Response.StatusCode.value__
        Assert-True ($status -eq 401) "Unauthenticated request to /backup-jobs/status returns 401 (got $status)"
    }
}
catch { Assert-True $false "Test 5 threw: $($_.Exception.Message)" }

if (-not $SkipCloudUnavailableTest) {
    Write-Host "`n=== Test 6: Unavailable cloud destination is tracked independently ===" -ForegroundColor Cyan
    try {
        $env:BACKUP_S3_BUCKET = "nonexistent-bucket-$suffix"
        $env:BACKUP_S3_ENDPOINT = "s3.invalid.example.test"
        & "$PSScriptRoot\Backup-Daily.ps1" -Trigger Manual | Out-Null
        # Script exits 0 as long as LOCAL succeeded, even if cloud failed -
        # that's the point: local and cloud success are tracked separately.
        Assert-True ($LASTEXITCODE -eq 0) "Backup with an unreachable cloud endpoint still succeeds locally (script exit 0)"
        Remove-Item Env:\BACKUP_S3_BUCKET, Env:\BACKUP_S3_ENDPOINT -ErrorAction SilentlyContinue
    }
    catch { Assert-True $false "Test 6 threw: $($_.Exception.Message)" }
}

# --- Cleanup: disposable resources only ---
Remove-Item Env:\DB_NAME, Env:\BACKUP_LOCAL_DEVICE_PATH, Env:\BACKUP_UPLOADS_PATH, Env:\BACKUP_STAGING_DIR, Env:\BACKUP_API_URL -ErrorAction SilentlyContinue
Invoke-Sql "DROP DATABASE IF EXISTS $scratchDb; DROP DATABASE IF EXISTS $scratchRestoreDb;" | Out-Null
icacls $scratchRepoRoot /reset /T /C 2>&1 | Out-Null
Remove-Item $scratchRepoRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
$passed = ($results | Where-Object { $_.Pass }).Count
$failed = ($results | Where-Object { -not $_.Pass }).Count
Write-Host "$passed passed, $failed failed (of $($results.Count) checks)"
if ($failed -gt 0) { exit 1 }
