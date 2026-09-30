<#
.SYNOPSIS
  Registers the two Windows Scheduled Tasks that drive the 3-2-1 backup
  arrangement: a daily incremental and a weekly full. Run once during setup
  (see docs/backup-runbook.md) - safe to re-run, it replaces any existing
  task definition with the same name.

.DESCRIPTION
  Tasks run "whether user is logged on or not" so they are independent of
  any browser/desktop session, and under the account that runs this script
  (pass -UserName/-Password for a dedicated service account instead of the
  interactive admin, if one exists on this host). Uses the confirmed
  schedule: daily 02:00, weekly Sunday 02:00, Asia/Manila.

  Windows Task Scheduler uses the SYSTEM's local timezone for trigger times.
  If this host's local timezone is not already Asia/Manila, adjust -DailyTime
  accordingly (e.g. Manila is UTC+8; if the host is UTC, pass 18:00 for the
  PREVIOUS day's 02:00 Manila).
#>
param(
    [string]$DailyTime = "02:00",
    [string]$WeeklyTime = "02:00",
    [string]$WeeklyDay = "Sunday",
    [string]$UserName,
    [securestring]$Password
)

$scriptsDir = $PSScriptRoot
$pwshExe = (Get-Command powershell.exe).Source

function Register-BackupTask {
    param([string]$TaskName, [string]$ScriptPath, [Microsoft.Management.Infrastructure.CimInstance]$Trigger)

    # -WindowStyle Hidden: without it, a task registered under Interactive
    # logon (the fallback path when SYSTEM registration isn't available -
    # see the catch block below) pops a visible PowerShell console in the
    # user's desktop session every time it fires, including on-demand runs
    # triggered from the admin UI. SYSTEM-logon tasks don't need this (they
    # run in Session 0, never visible) but it's harmless there too.
    $action = New-ScheduledTaskAction -Execute $pwshExe `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`" -Trigger Scheduled"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
        -ExecutionTimeLimit (New-TimeSpan -Hours 6) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)

    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    if ($UserName -and $Password) {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $Trigger -Settings $settings `
            -User $UserName -Password $plain -RunLevel Highest | Out-Null
    }
    else {
        try {
            # Preferred for production: SYSTEM runs independent of any
            # interactive login, but registering it requires an elevated
            # (Run as Administrator) PowerShell session.
            Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $Trigger -Settings $settings `
                -User "SYSTEM" -RunLevel Highest -ErrorAction Stop | Out-Null
        }
        catch {
            Write-Host "Could not register as SYSTEM (needs an elevated/Administrator session) - falling back to the current user ($env:USERNAME, Interactive logon, standard privileges)." -ForegroundColor Yellow
            Write-Host "This means the task only runs while $env:USERNAME is logged in - re-run this script from an elevated PowerShell session (or with -UserName/-Password for a dedicated service account) for a login-independent production schedule." -ForegroundColor Yellow
            # No RunLevel Highest here: requesting elevated execution for the
            # registered task ALSO requires the registering session itself
            # to already be elevated (the same restriction that just failed
            # above), and none of these scripts actually need admin rights -
            # mysqldump/mysqlbinlog authenticate over the network via SQL
            # credentials, restic and robocopy only touch user-writable paths.
            $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
            Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $Trigger -Settings $settings -Principal $principal | Out-Null
        }
    }
    Write-Host "Registered task '$TaskName'."
}

$dailyTrigger = New-ScheduledTaskTrigger -Daily -At $DailyTime
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $WeeklyDay -At $WeeklyTime

Register-BackupTask -TaskName "ConstructIQ-Backup-Daily" -ScriptPath (Join-Path $scriptsDir "Backup-Daily.ps1") -Trigger $dailyTrigger
Register-BackupTask -TaskName "ConstructIQ-Backup-Weekly" -ScriptPath (Join-Path $scriptsDir "Backup-Weekly.ps1") -Trigger $weeklyTrigger

Write-Host ""
Write-Host "Done. Verify with: schtasks /query /tn ConstructIQ-Backup-Daily /v /fo list"
Write-Host "                   schtasks /query /tn ConstructIQ-Backup-Weekly /v /fo list"
Write-Host "Trigger a run immediately with: schtasks /run /tn ConstructIQ-Backup-Weekly"
