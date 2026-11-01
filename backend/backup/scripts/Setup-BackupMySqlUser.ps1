<#
.SYNOPSIS
  One-time setup: creates the dedicated, minimum-privilege MySQL identity
  the backup scripts use (never the app's own root/DB_USER credential).

.DESCRIPTION
  Generates a fresh random password (never derived from JWT_SECRET or any
  existing app secret), grants only what mysqldump --single-transaction and
  binlog archiving need, and writes the password to a file OUTSIDE this
  repository (BACKUP_SECRETS_DIR) so it can never be committed. Safe to
  re-run - CREATE USER IF NOT EXISTS makes it idempotent, and re-running
  rotates the password.

.PARAMETER SecretsDir
  Where the generated password is written. Defaults to backend\backup\secrets
  (gitignored - see .gitignore) purely because this was set up from an
  environment that can only write inside the repo working directory. THIS IS
  NOT the recommended production location: a backup secret has no business
  living on the same disk as Copy 1, let alone inside a folder that gets
  mirrored to OneDrive. Before going live, an administrator must move this
  directory to a location outside both the repo and any cloud-synced folder
  (e.g. a local path under C:\ that nothing syncs) and re-point
  BACKUP_SECRETS_DIR at it - see docs/backup-runbook.md step 4.
#>
param(
    [string]$DbHost = $(if ($env:DB_HOST) { $env:DB_HOST } else { "localhost" }),
    [int]$DbPort = $(if ($env:DB_PORT) { [int]$env:DB_PORT } else { 3306 }),
    [string]$RootUser = $(if ($env:DB_USER) { $env:DB_USER } else { "root" }),
    [string]$SecretsDir = $(if ($env:BACKUP_SECRETS_DIR) { $env:BACKUP_SECRETS_DIR } else { Join-Path $PSScriptRoot "..\secrets" }),
    [string]$MySqlBinDir = "C:\Program Files\MySQL\MySQL Server 8.0\bin"
)

$ErrorActionPreference = "Stop"

# Root password: prefer an explicit env var (matches the app's own DB_PASSWORD
# convention) so this never has to be typed or pasted into a terminal.
$rootPassword = $env:DB_PASSWORD
if (-not $rootPassword) {
    throw "Set `$env:DB_PASSWORD to the MySQL root password before running this script (same value the app itself uses)."
}

if (-not (Test-Path $SecretsDir)) {
    New-Item -ItemType Directory -Path $SecretsDir -Force | Out-Null
}

# 24 random bytes as hex (48 chars) - safe inside a single-quoted SQL string
# with no escaping concerns, unlike Base64's '+', '/', '='.
$bytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
$rng.GetBytes($bytes)
$rng.Dispose()
$backupPassword = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

$sql = @"
CREATE USER IF NOT EXISTS 'constructiq_backup'@'localhost' IDENTIFIED BY '$backupPassword';
ALTER USER 'constructiq_backup'@'localhost' IDENTIFIED BY '$backupPassword';
GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, RELOAD, REPLICATION CLIENT, REPLICATION SLAVE ON *.* TO 'constructiq_backup'@'localhost';
FLUSH PRIVILEGES;
"@

$mysqlExe = Join-Path $MySqlBinDir "mysql.exe"
if (-not (Test-Path $mysqlExe)) { throw "mysql.exe not found at $mysqlExe - adjust -MySqlBinDir." }

$env:MYSQL_PWD = $rootPassword
try {
    $sql | & $mysqlExe -h $DbHost -P $DbPort -u $RootUser
    if ($LASTEXITCODE -ne 0) { throw "mysql.exe exited with code $LASTEXITCODE" }
}
finally {
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
}

$passwordFile = Join-Path $SecretsDir "mysql-backup-user-password.txt"
Set-Content -Path $passwordFile -Value $backupPassword -NoNewline -Encoding ascii

# Lock the directory and file down to the current user + Administrators only,
# AFTER writing (restricting first can deny the write itself). Uses the
# actual Windows identity the process is running as, not $env:USERNAME,
# which isn't always populated the same way across launch contexts.
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $SecretsDir /inheritance:r /grant:r "${currentUser}:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
icacls $passwordFile /inheritance:r /grant:r "${currentUser}:F" "Administrators:F" | Out-Null

Write-Host "constructiq_backup@localhost created/rotated. Password written to: $passwordFile"
Write-Host "This file is the ONLY copy outside MySQL itself - back it up to a secure secondary location (e.g. a password manager). It is never stored in the repo or in any backup this identity creates."
