<#
.SYNOPSIS
  Restores the latest (or a specific) backup chain from the LOCAL device
  repository into a brand-new, isolated database and uploads folder.

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
$startedAt = Get-Date
$lock = Enter-BackupLock -LockName "backup"
$success = $false
$errorMessage = $null
$usedChainTag = $ChainTag

try {
    Write-BackupLog "=== Local restore starting: target DB '$TargetDbName' ==="
    $usedChainTag = Invoke-BackupRestore -Config $config -Repository $config.BACKUP_LOCAL_DEVICE_PATH `
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
        localSuccess = $success
        cloudSuccess = $null
        fullChainTag = $usedChainTag
        errorMessage = $errorMessage
        hostName     = $env:COMPUTERNAME
    }
    if ($success) { exit 0 } else { exit 1 }
}
