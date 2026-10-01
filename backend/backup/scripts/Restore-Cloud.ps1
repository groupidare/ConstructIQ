<#
.SYNOPSIS
  Restores the latest (or a specific) backup chain from the CLOUD (off-site)
  repository into a brand-new, isolated database and uploads folder.

.DESCRIPTION
  Deliberately independent of Restore-Local.ps1's repository - this is the
  path that must work even if the original server and its local device
  repository are both gone. It never reads BACKUP_LOCAL_DEVICE_PATH.

.PARAMETER Confirm
  Required switch - restoring is destructive to whatever already exists at
  TargetDbName/TargetUploadsPath, so this is never implicit.
#>
param(
    [Parameter(Mandatory)][string]$TargetDbName,
    [Parameter(Mandatory)][string]$TargetUploadsPath,
    [string]$ChainTag,
    [switch]$Confirm
)

. "$PSScriptRoot\Common.ps1"
if (-not $Confirm) { throw "Restore is destructive to the target. Re-run with -Confirm." }

$config = Get-BackupConfig
if (-not $config.BACKUP_S3_BUCKET) { throw "BACKUP_S3_BUCKET is not configured - there is no cloud repository to restore from yet." }
$cloudRepo = "s3:$($config.BACKUP_S3_ENDPOINT)/$($config.BACKUP_S3_BUCKET)"

$startedAt = Get-Date
$lock = Enter-BackupLock -LockName "backup"
$success = $false
$errorMessage = $null
$usedChainTag = $ChainTag

try {
    Write-BackupLog "=== Cloud restore starting: target DB '$TargetDbName' (repository: $cloudRepo) ==="
    $usedChainTag = Invoke-BackupRestore -Config $config -Repository $cloudRepo -IsCloud `
        -TargetDbName $TargetDbName -TargetUploadsPath $TargetUploadsPath -ChainTag $ChainTag
    $success = $true
}
catch {
    $errorMessage = $_.Exception.Message
    Write-BackupLog "Restore FAILED: $errorMessage" "ERROR"
}
finally {
    Exit-BackupLock -LockFile $lock
    Send-BackupJobReport -Config $config -Report @{
        jobType      = "Restore"
        trigger      = "Manual"
        startedAt    = $startedAt.ToUniversalTime().ToString("o")
        completedAt  = (Get-Date).ToUniversalTime().ToString("o")
        localSuccess = $null
        cloudSuccess = $success
        fullChainTag = $usedChainTag
        errorMessage = $errorMessage
        hostName     = $env:COMPUTERNAME
    }
    if ($success) { exit 0 } else { exit 1 }
}
