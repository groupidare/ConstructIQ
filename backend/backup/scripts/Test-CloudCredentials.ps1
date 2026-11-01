<#
.SYNOPSIS
  Verifies the configured Backblaze B2 (or any S3-compatible) credentials
  and bucket actually work end-to-end, using disposable dummy data only -
  never touches the real database, the real uploads folder, or the local
  restic repository's real snapshots.

.DESCRIPTION
  Exercises exactly the restic operations the real backup/restore scripts
  depend on, so a permission gap shows up here instead of during a real
  backup or, worse, a real disaster recovery:
    1. restic init (idempotent - skipped if already initialized)
    2. restic unlock (lock cleanup - proves delete/list access to the
       repository's lock objects, not just write access to data blobs)
    3. restic backup of one throwaway file (write/upload)
    4. restic restore of that snapshot into a scratch folder (read/download)
    5. Byte-for-byte comparison of restored vs. original (integrity)
    6. restic forget --prune on the dummy snapshot (delete permission -
       B2 application keys are sometimes issued read+write only, without
       delete, which would silently break retention pruning later)
    7. restic check (repository-wide structural integrity)

  Run this after any credential rotation (quarterly, per the runbook) or
  right after wiring up a new cloud account for the first time.
#>
. "$PSScriptRoot\Common.ps1"

$config = Get-BackupConfig
if (-not $config.BACKUP_S3_BUCKET) { throw "BACKUP_S3_BUCKET is not set in backup.env - nothing to test." }
$cloudRepo = "s3:$($config.BACKUP_S3_ENDPOINT)/$($config.BACKUP_S3_BUCKET)"

$scratchDir = Join-Path $config.BACKUP_STAGING_DIR ("cloudtest-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $scratchDir -Force | Out-Null
$dummyFile = Join-Path $scratchDir "dummy.txt"
$dummyContent = "ConstructIQ cloud credential test - $(Get-Date -Format o) - $(New-Guid)"
Set-Content -Path $dummyFile -Value $dummyContent -NoNewline

$results = New-Object System.Collections.Generic.List[string]
function Record($name, [bool]$ok, $detail = "") {
    $status = if ($ok) { "PASS" } else { "FAIL" }
    $line = "[$status] $name" + $(if ($detail) { " - $detail" } else { "" })
    $results.Add($line)
    Write-BackupLog $line
}

try {
    Write-BackupLog "=== Cloud credential test starting against bucket '$($config.BACKUP_S3_BUCKET)' ($($config.BACKUP_S3_ENDPOINT)) ==="

    $initialized = Test-ResticRepoInitialized -Config $config -Repository $cloudRepo -IsCloud
    if (-not $initialized) {
        Invoke-Restic -Config $config -Repository $cloudRepo -ResticArgs @("init") -IsCloud | Out-Null
        Record "restic init" $true "repository created"
    } else {
        Record "restic init" $true "already initialized"
    }

    try {
        Invoke-Restic -Config $config -Repository $cloudRepo -ResticArgs @("unlock") -IsCloud | Out-Null
        Record "restic unlock (lock cleanup)" $true
    } catch { Record "restic unlock (lock cleanup)" $false $_.Exception.Message }

    $snapId = $null
    try {
        Invoke-Restic -Config $config -Repository $cloudRepo -IsCloud `
            -ResticArgs @("backup", $dummyFile, "--tag", "credential-test") | Out-Null
        $latest = (Invoke-Restic -Config $config -Repository $cloudRepo -ResticArgs @("snapshots", "--json", "--tag", "credential-test") -IsCloud | Out-String | ConvertFrom-Json) | Select-Object -Last 1
        $snapId = $latest.short_id
        Record "restic backup (write/upload)" $true "snapshot $snapId"
    } catch { Record "restic backup (write/upload)" $false $_.Exception.Message }

    if ($snapId) {
        $restoreDir = Join-Path $scratchDir "restored"
        try {
            Invoke-Restic -Config $config -Repository $cloudRepo -IsCloud -ResticArgs @("restore", $snapId, "--target", $restoreDir) | Out-Null
            $restoredFile = Get-ChildItem -Path $restoreDir -Filter "dummy.txt" -Recurse | Select-Object -First 1
            if (-not $restoredFile) { throw "restored dummy.txt not found under $restoreDir" }
            $restoredContent = Get-Content $restoredFile.FullName -Raw
            if ($restoredContent -ne $dummyContent) { throw "restored content does not match original (corruption or wrong file)" }
            Record "restic restore + integrity check (read/download)" $true "content matches byte-for-byte"
        } catch { Record "restic restore + integrity check (read/download)" $false $_.Exception.Message }

        try {
            Invoke-Restic -Config $config -Repository $cloudRepo -IsCloud -ResticArgs @("forget", $snapId, "--prune") | Out-Null
            Record "restic forget --prune (delete permission)" $true
        } catch { Record "restic forget --prune (delete permission)" $false $_.Exception.Message }
    }

    try {
        Invoke-Restic -Config $config -Repository $cloudRepo -ResticArgs @("check") -IsCloud | Out-Null
        Record "restic check (repository integrity)" $true
    } catch { Record "restic check (repository integrity)" $false $_.Exception.Message }
}
finally {
    Remove-Item $scratchDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-BackupLog "=== Cloud credential test results ==="
$results | ForEach-Object { Write-BackupLog $_ }
$failures = $results | Where-Object { $_ -like "[FAIL]*" }
if ($failures.Count -gt 0) {
    Write-BackupLog "$($failures.Count) check(s) FAILED - cloud credentials are NOT fully verified." "ERROR"
    exit 1
} else {
    Write-BackupLog "All checks passed - cloud credentials and bucket permissions verified end-to-end."
    exit 0
}
