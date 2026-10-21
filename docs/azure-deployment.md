# Azure deployment

How the live site at **https://constructiq.cfd** runs, how code gets deployed to it, and what to do when something breaks.

> No passwords, keys or tokens belong in this file or anywhere in git. They live only in the places listed under [Settings and secrets](#settings-and-secrets).

## The short version

- **To deploy:** merge or push to `main`. A GitHub Actions run on the VM builds and restarts whatever changed, usually within 3–5 minutes. Watch it in the repo's **Actions** tab.
- **If a build fails,** nothing is restarted and the previous version stays live.
- **To undo a bad deploy:** `git revert <commit>` and push. See [Rolling back](#rolling-back).
- **You never need to log in to the VM** for normal work.

## How it's set up

```
Browser ──HTTPS──▶ Caddy (ports 80/443, HTTPS certificates)
                     ├── constructiq.cfd, www.  ──▶ Frontend (Next.js)   127.0.0.1:3000
                     └── api.constructiq.cfd    ──▶ Backend  (ASP.NET)   127.0.0.1:5000
                                                       └──▶ ML service (FastAPI) 127.0.0.1:8000

Backend + ML service ──TLS──▶ MySQL on Aiven (constructiq-db, free plan)
ML service ──▶ Cloudflare R2 (trained model files)
```

| Piece | Where |
|---|---|
| Server | Azure VM **ConstructIQ**, Windows Server 2022, region **Korea Central**, public IP **20.41.106.145** (static). Paid from an Azure for Students subscription ($100 credit, budget alert set). |
| Domain | `constructiq.cfd` at **Namecheap**, Advanced DNS: A records for `@`, `www`, `api` → `20.41.106.145`. The `send`, `rsend` and `resend._domainkey` records are for Resend email — leave them alone. |
| Database | **Aiven** MySQL `constructiq-db`. Free plans power off when unused for a while; power it back on from the Aiven console if the app suddenly can't reach the database. |
| ML models | Saved locally in `ml-service\trained_models` **and** in R2. A restart reloads the active model — it never needs retraining because of a restart. |

The ML service only listens on `127.0.0.1`, so it's unreachable from the internet; that's why `ML_API_KEY` isn't needed on this server.

### On the VM

| Path | What it is |
|---|---|
| `C:\apps\ConstructIQ` | Git checkout of this repo. The ML service runs straight from here. |
| `C:\apps\publish\backend` | The built backend the service runs. **`wwwroot\uploads` here holds user uploads (avatars etc.) that exist nowhere else** — deploys never touch it. |
| `C:\apps\publish\frontend` | Copy of the built frontend the service runs. |
| `C:\apps\Caddyfile` | Caddy's config (which domain goes to which port). |
| `C:\apps\logs\` | One log file per service, e.g. `CIQ-Backend.log`. |
| `C:\apps\ca.pem` | Aiven's CA certificate, used by the ML service for TLS. |
| `C:\actions-runner` | The GitHub Actions runner that performs deploys. |

### Windows services

All four start automatically when the VM boots and restart themselves if they crash (managed by NSSM).

| Service | Runs |
|---|---|
| `CIQ-ML` | `ml-service\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000` |
| `CIQ-Backend` | `dotnet C:\apps\publish\backend\ConstructIQ.API.dll --urls http://127.0.0.1:5000` |
| `CIQ-Frontend` | `node node_modules\next\dist\bin\next start -p 3000 -H 127.0.0.1` in `C:\apps\publish\frontend` |
| `CIQ-Caddy` | `caddy run --config C:\apps\Caddyfile` |
| `actions.runner.groupidare-ConstructIQ.ConstructIQ` | The deploy runner (runs as LocalSystem so it can restart the services above). |

## Settings and secrets

| Service | Where its settings are |
|---|---|
| Backend | **Windows machine environment variables** (`DB_*`, `JWT_*`, `FRONTEND_URL`, `ML_SERVICE_URL`, `GOOGLE_*`, `RESEND_*`, …). It doesn't read any `.env` file. |
| ML service | `C:\apps\ConstructIQ\ml-service\.env` (`DATABASE_URL`, `DB_SSL_CA`, `R2_*`). Not in git. |
| Frontend | `C:\apps\ConstructIQ\frontend\.env.production` (`NEXT_PUBLIC_API_URL=https://api.constructiq.cfd/api`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Not in git. These are baked in at **build** time. |

**Changing a backend environment variable** (in an Administrator PowerShell on the VM):

```powershell
[Environment]::SetEnvironmentVariable('NAME', 'value', 'Machine')
Restart-Computer
```

The reboot is required: Windows services only pick up machine environment variables that existed when Windows started, so restarting just the service isn't enough.

**Changing `frontend\.env.production`:** edit it, then run a full deploy (see below) so the frontend is rebuilt.

**Changing `ml-service\.env`:** edit it, then `Restart-Service CIQ-ML`.

## Deploying

### Automatic (normal)

Every push to `main` triggers [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), which runs on the VM and calls [deploy/update.ps1](../deploy/update.ps1). The script:

1. Pulls the new commit and works out which of `backend/`, `frontend/`, `ml-service/` changed.
2. **Builds everything that changed first** — backend into `C:\apps\publish\backend-new`, frontend in the checkout, and an import check for the ML service. Frontend packages are only reinstalled when `package.json`/`package-lock.json` changed; Python packages only when `requirements.txt` changed.
3. Only if every build passed: stops, swaps in and restarts each changed service (a few seconds of downtime each).
4. Checks each restarted service responds. If one doesn't, the run fails and names the log to check.

Changes only to docs or other folders deploy nothing ("No app code changed").

Only pushes to `main` and manual runs deploy — pull requests never do, so unmerged code can't run on the server. Work on a branch and merge through a pull request.

### Manual run from GitHub

**Actions → Deploy to Azure VM → Run workflow.** Tick **"Rebuild and restart every service"** to rebuild everything regardless of what changed (this reinstalls frontend packages, so it takes ~15 minutes).

### Manual run on the VM

In an Administrator PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File C:\apps\ConstructIQ\deploy\update.ps1        # pull + deploy what changed
powershell -ExecutionPolicy Bypass -File C:\apps\ConstructIQ\deploy\update.ps1 -All   # rebuild + restart everything
```

## Rolling back

```bash
git log --oneline        # find the bad commit
git revert <commit>      # adds a commit that undoes it
git push                 # auto-deploys the previous behaviour
```

Or click **Revert** on the merged pull request in GitHub. Two things a revert does **not** undo:

- **Database changes.** The backend applies EF Core migrations automatically when it starts, so a migration that altered or dropped data stays applied. Back up the database before merging anything that changes the schema — see [backup-runbook.md](backup-runbook.md).
- **A retrained model.** Each training run is saved as its own version in R2, so an older one can be made active again, but reverting code doesn't do it for you.

## Checking on things

On the VM, in PowerShell:

```powershell
Get-Service CIQ-* | Format-Table Name, Status          # are they running?
Get-Content C:\apps\logs\CIQ-Backend.log -Tail 50      # recent log lines (also CIQ-ML, CIQ-Frontend, CIQ-Caddy)
Restart-Service CIQ-Backend                            # restart one service
```

Health checks from the VM: `http://127.0.0.1:8000/health` (ML). The backend and frontend have no health page — any response, even a 404 at `/`, means they're up.

The Caddy log will show errors from internet scanners (e.g. `leakix.net`, requests for `/wp-admin` or `/.env`, `invalid CR in chunked line`). These are harmless background noise on every public server.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Site down after a Windows update | Services should come back by themselves; check `Get-Service CIQ-*` and the logs. |
| App loads but data doesn't / login fails with server errors | Aiven database powered off — power it on in the Aiven console. Or check `CIQ-Backend.log`. |
| Deploy run fails at **Building frontend** with `EPERM` | A file in `frontend\node_modules` is locked by another process (an open editor or terminal running the dev server on the VM). Close it and re-run. |
| Deploy run fails with `dubious ownership` | Run `git config --system --add safe.directory C:/apps/ConstructIQ` on the VM. |
| Deploy run stuck on "Waiting for a runner" | The runner service stopped: `Get-Service actions.runner.*`, then `Start-Service` it. Check it shows **Idle** under Settings → Actions → Runners. |
| HTTPS certificate error in the browser | Check `CIQ-Caddy.log`. Caddy renews certificates by itself; it needs ports 80 and 443 open in both the Azure network security group and Windows Firewall. |
| Redirects send you to `localhost:3000` | Something is building redirect URLs from `request.url`. Use the forwarded host instead, as in [frontend/src/middleware.ts](../frontend/src/middleware.ts). |

## Access

- **Azure portal:** teammates who need to restart or resize the VM have the **Contributor** role on the resource group.
- **Remote Desktop:** `20.41.106.145` with a Windows account on the VM. Port 3389 should only be open to specific IPs (VM → Networking).
- **GitHub:** repo owner is `groupidare`. Fork pull requests from outside contributors require approval before any workflow runs (Settings → Actions → General), because the deploy runner has admin rights on the server.
