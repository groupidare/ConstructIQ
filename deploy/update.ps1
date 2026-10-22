# Deploys the latest code on the Azure VM (Windows Server, services run by NSSM).
#
# Run by the GitHub Actions self-hosted runner on every push to main (see
# .github/workflows/deploy.yml), or by hand on the VM:
#
#   powershell -ExecutionPolicy Bypass -File C:\apps\ConstructIQ\deploy\update.ps1        # pull + deploy what changed
#   powershell -ExecutionPolicy Bypass -File C:\apps\ConstructIQ\deploy\update.ps1 -All   # rebuild + restart everything
#
# Everything is BUILT before anything is restarted, so a push that fails to
# build stops here and the currently running version stays live. The backend
# and frontend run from copies under C:\apps\publish, not from the git
# checkout, which is what makes that possible.

param(
  [string]$Since,   # commit to diff against; the workflow passes the HEAD it had before pulling
  [switch]$All
)

$ErrorActionPreference = 'Stop'
$repo    = 'C:\apps\ConstructIQ'
$publish = 'C:\apps\publish'

function Step($msg) { Write-Host "`n==> $msg" }

function Exec([scriptblock]$cmd, [string]$what) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" }
}

# robocopy exit codes 0-7 mean success (files copied/skipped); 8+ is a failure.
function Mirror([string]$from, [string]$to, [string[]]$excludeDirs = @()) {
  $xd = @()
  if ($excludeDirs.Count) { $xd = @('/XD') + $excludeDirs }
  robocopy $from $to /MIR /NFL /NDL /NJH /NJS /NP @xd | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $from to $to failed (robocopy exit code $LASTEXITCODE)" }
  $global:LASTEXITCODE = 0
}

# Any HTTP response at all (even a 404) means the process is up and listening.
function Wait-Up([string]$name, [string]$url, [int]$timeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5 | Out-Null; Write-Host "$name is up"; return }
    catch { if ($_.Exception.Response) { Write-Host "$name is up"; return } }
    Start-Sleep -Seconds 3
  }
  throw "$name did not respond at $url within $timeoutSec seconds - check C:\apps\logs\$name.log"
}

Set-Location $repo

if (-not $Since) {
  $Since = (git rev-parse HEAD).Trim()
  Step 'Pulling latest code'
  Exec { git pull --ff-only } 'git pull'
}
$head = (git rev-parse HEAD).Trim()

if ($All) {
  $changed = @('backend/', 'frontend/package-lock.json', 'ml-service/requirements.txt')
} elseif ($Since -eq $head) {
  Step 'Already up to date - nothing to deploy'
  exit 0
} else {
  $changed = @(git diff --name-only $Since $head)
}

$backend   = [bool]($changed -match '^backend/')
$frontend  = $All -or [bool]($changed -match '^frontend/')
$ml        = $All -or [bool]($changed -match '^ml-service/')
$feDeps    = [bool]($changed -match '^frontend/package(-lock)?\.json$')
$mlDeps    = [bool]($changed -match '^ml-service/requirements\.txt$')

Write-Host "Deploying $($Since.Substring(0,7))..$($head.Substring(0,7)): backend=$backend frontend=$frontend ml=$ml"
if (-not ($backend -or $frontend -or $ml)) { Step 'No app code changed - nothing to restart'; exit 0 }

# ── 1. Build everything first (nothing live is touched yet) ──────────────────
if ($backend) {
  Step 'Building backend'
  if (Test-Path "$publish\backend-new") { Remove-Item "$publish\backend-new" -Recurse -Force }
  Exec { dotnet publish "$repo\backend\ConstructIQ.API\ConstructIQ.API.csproj" -c Release -o "$publish\backend-new" } 'Backend build'
}

if ($frontend) {
  Step 'Building frontend'
  Push-Location "$repo\frontend"
  try {
    if ($feDeps -or -not (Test-Path node_modules)) { Exec { npm ci } 'npm ci' }
    Exec { npm run build } 'Frontend build'
  } finally { Pop-Location }
}

if ($ml) {
  Step 'Checking ML service'
  Push-Location "$repo\ml-service"
  try {
    if ($mlDeps) { Exec { .\venv\Scripts\pip install -r requirements.txt } 'pip install' }
    # Catches syntax errors and missing imports before the running service is restarted.
    Exec { .\venv\Scripts\python -c "import app.main" } 'ML import check'
  } finally { Pop-Location }
}

# ── 2. All builds passed - swap in the new versions ──────────────────────────
if ($backend) {
  Step 'Releasing backend'
  Stop-Service CIQ-Backend
  # wwwroot\uploads holds user-uploaded files (avatars etc.) that only exist
  # here, never in git - excluding it keeps /MIR from deleting them.
  Mirror "$publish\backend-new" "$publish\backend" @("$publish\backend\wwwroot\uploads", "$publish\backend-new\wwwroot\uploads")
  Start-Service CIQ-Backend
}

if ($frontend) {
  Step 'Releasing frontend'
  Stop-Service CIQ-Frontend
  Mirror "$repo\frontend" "$publish\frontend"
  Start-Service CIQ-Frontend
}

if ($ml) {
  Step 'Restarting ML service'
  Restart-Service CIQ-ML
}

# ── 3. Confirm everything came back ──────────────────────────────────────────
Step 'Checking services'
if ($ml)       { Wait-Up 'CIQ-ML'       'http://127.0.0.1:8000/health' }
if ($backend)  { Wait-Up 'CIQ-Backend'  'http://127.0.0.1:5000/' }
if ($frontend) { Wait-Up 'CIQ-Frontend' 'http://127.0.0.1:3000/' }

Step "Deployed $($head.Substring(0,7))"
