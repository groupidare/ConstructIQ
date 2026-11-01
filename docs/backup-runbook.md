# ConstructIQ Backup & Disaster Recovery Runbook

This is the operational runbook for ConstructIQ's automated 3-2-1 backup arrangement, covering setup, routine operation, and disaster recovery. It complements — and never replaces — the existing manual "Download database backup" feature in Settings, which remains available as a break-glass export.

## What this arrangement actually does

- **Copy 1**: the live `constructiq` MySQL database and `backend/ConstructIQ.API/wwwroot/uploads/`, on this server.
- **Copy 2**: an encrypted backup on a **separate local device** (an external/portable drive — not a second folder on this same disk).
- **Copy 3**: the same backup, encrypted, replicated to an **off-site, S3-compatible cloud destination**.
- **Weekly full**: a fresh, complete, standalone `mysqldump --single-transaction` logical database dump — restorable entirely on its own.
- **Daily incremental**: the MySQL binary log files written since the last checkpoint, archived over the MySQL protocol (`mysqlbinlog --read-from-remote-server`). This is real point-in-time recovery — restoring any day requires the most recent weekly full **plus** replaying every incremental since. It is not a fresh dump, and not a copy of a copy.
- **restic** is the encryption, local/cloud transport, deduplication, and retention layer wrapping both of the above, plus giving the uploads folder genuine incremental file backup. restic is not the database's incremental mechanism — MySQL's binary log is.

## Known limitations (read before relying on this)

- **Copy 2 has not been verified against a real external drive.** No such drive was attached to the machine this was built on. `BACKUP_LOCAL_DEVICE_PATH` defaults to a folder inside this repo purely so the scripts could be tested at all — **that default is a second folder on the same disk and does not satisfy the 3-2-1 requirement.** Step 3 below explains how to point it at real separate media.
- **Copy 3's cloud credentials are verified against the real Backblaze B2 bucket** (`Test-CloudCredentials.ps1`, 2026-09-30): init, lock cleanup, upload, download+integrity, delete/prune, and repository-check all passed against disposable dummy data. **What is still pending**: a real Weekly/Daily job has not yet run end-to-end against this bucket with actual database/uploads content, so `lastSuccessfulCloudCopy` in the status panel will still read "Never" until that happens (Step 6). Copy 3 existing and being reachable is confirmed; Copy 3 being routinely populated by the real schedule is not yet.
- **Cross-database contamination on a shared MySQL instance.** The archived binary log is server-wide, not scoped to one database. `--rewrite-db` protects the *target* database during restore, but if this MySQL instance ever hosts a second database alongside `constructiq`, that second database's changes from the same window would also replay, unfiltered, against its own live name. Not a concern for this app's actual single-database deployment; would need addressing (e.g. a dedicated MySQL instance) before hosting anything else alongside it.
- **The scheduled tasks were registered under an interactive user logon** on the build machine (registering as SYSTEM requires an elevated/Administrator PowerShell session, which wasn't available). This means the schedule currently depends on that user being logged in. Step 5 explains how to re-register properly for a production host.
- Restoring under Task Scheduler's own dispatch (vs. running the script directly) was not fully observed to complete end-to-end in the build environment — the script itself is proven correct (24/24 relevant automated checks + a real full/incremental/restore cycle against live data, see Step 7), but re-verify the *scheduled* trigger actually fires after registering on the real production host.

---

## 1. Install required tools

On the Windows host that runs MySQL:

```powershell
winget install --id restic.restic -e --accept-source-agreements --accept-package-agreements
```

Restart the shell afterward so `restic` resolves on `PATH` (the scripts also fall back to the winget install path directly, so this isn't strictly required for them to work).

MySQL client tools (`mysql.exe`, `mysqldump.exe`, `mysqlbinlog.exe`) must already be present — they ship with MySQL Server 8.0. Confirm `backend\backup\backup.env`'s `MYSQL_BIN_DIR` points at that folder.

## 2. Create the dedicated backup MySQL identity

Never use the app's own root/`DB_USER` credential for backups. Run once:

```powershell
$env:DB_PASSWORD = "<the real MySQL root password>"
.\backend\backup\scripts\Setup-BackupMySqlUser.ps1
```

This creates `constructiq_backup@localhost` with only `SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, RELOAD, REPLICATION CLIENT, REPLICATION SLAVE` — enough to dump and archive binlogs, nothing that can modify application data. The generated password is written to `backend\backup\secrets\mysql-backup-user-password.txt` (see Step 4 for why that directory must move before production use). Clear `$env:DB_PASSWORD` afterward.

## 3. Set up the local backup device (Copy 2)

1. Attach a dedicated external/portable drive to this host — not a network share pretending to be local, not another folder on the C: drive.
2. Create a folder on it for the restic repository, e.g. `E:\ConstructIQ-Backups\restic-repo`.
3. Set `BACKUP_LOCAL_DEVICE_PATH=E:\ConstructIQ-Backups\restic-repo` in `backend\backup\backup.env` (copy from `backup.env.example` if that file doesn't exist yet).
4. Leave the drive connected for scheduled runs, but consider the operational tradeoff: a drive that's *always* connected is more vulnerable to the same ransomware/failure event as the live server. Periodically rotating between two drives (one connected, one offline in a different physical location) is a stronger posture than this runbook automates today.

## 4. Set up off-site cloud storage (Copy 3)

Any S3-compatible provider works. **This deployment uses Backblaze B2**, bucket `constructiq-backups-2026-a7k9` in the `us-west-004` region, provisioned 2026-09-30, with a dedicated application key (name `constructiq-backup`) scoped to that one bucket.

1. Create a private bucket (public access disabled). ✅ done.
2. Create a dedicated application key scoped to **only that bucket**. ✅ done — and its actual capabilities were verified for real (`Test-CloudCredentials.ps1`, Step 4.4 below), rather than assumed from what the B2 console form said was selected. A key that turned out to be read/write-only without delete would have broken retention pruning and lock cleanup silently until the first prune ran weeks later — worth checking immediately instead.
3. **Credentials never go in `backup.env`** (that file lives inside this repo, which is itself under OneDrive — a real secret has no business being synced to a third party's cloud that isn't Copy 3 on purpose). Instead they live in `BACKUP_SECRETS_DIR`, alongside the other three backup secrets, all relocated together off this disk:
   - Directory: `C:\ConstructIQ-Backup-Secrets` (a plain local path, sibling to — not inside — the OneDrive-synced project folder), ACL-locked via `icacls` to only the Windows identity the scheduled tasks run as (plus Administrators).
   - Files in it: `mysql-backup-user-password.txt`, `restic-password.txt`, `backup-report-token.txt`, `b2-key-id.txt`, `b2-application-key.txt`.
   - `backup.env` only needs the non-secret `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, and `BACKUP_SECRETS_DIR=C:\ConstructIQ-Backup-Secrets` — `Common.ps1`'s `Invoke-Restic` reads the B2 key/secret out of the two `b2-*.txt` files automatically.
   - **To rotate the key later without pasting it anywhere persistent**, overwrite those two files directly (`Set-Content` from an interactive `Read-Host -AsSecureString` prompt, or hand-edit them locally) — never through a channel that logs plaintext.
4. **Verify the key's actual permissions before trusting it**, using disposable data only — never the real database or uploads folder:
   ```powershell
   .\backend\backup\scripts\Test-CloudCredentials.ps1
   ```
   This runs `restic init` → `unlock` (lock cleanup) → `backup` (write) → `restore` + byte-for-byte compare (read) → `forget --prune` (delete) → `check` (repository integrity) against one throwaway file, tagged `credential-test` and pruned again immediately after. Re-run this after every key rotation. **Verified 2026-09-30: all 6 checks passed** — the `constructiq-backup` B2 key has full read/write/delete on the bucket.
5. Also add `BACKUP_REPORT_TOKEN` (the same value as `backup-report-token.txt`) to `backend\ConstructIQ.API\appsettings.json` (or `appsettings.Production.json`) — this is what authenticates the unattended scripts to `POST /api/v1/system/backup-jobs/report` without a user login. **Never reuse `JWT_SECRET`.**
6. **The single most critical secret is `restic-password.txt`.** If it's lost, every backup in both repositories becomes permanently unrecoverable — restic has no recovery mechanism for a lost repository password. Store a second copy in a physically separate location (a password manager, a printed copy in a safe) the moment it's generated.

## 5. Activate the schedule

```powershell
.\backend\backup\scripts\Register-BackupSchedule.ps1
```

Registers two Windows Scheduled Tasks: `ConstructIQ-Backup-Daily` (02:00 daily) and `ConstructIQ-Backup-Weekly` (Sunday 02:00), Asia/Manila. **Run this from an elevated ("Run as Administrator") PowerShell session** so the tasks register under SYSTEM and run independent of any interactive login — without elevation, the script falls back to registering under the current interactive user, which only runs while that user is logged in (this is what happened in development; fix it here in production). For a dedicated service account instead of SYSTEM, pass `-UserName` and `-Password`.

Verify:
```powershell
Get-ScheduledTask -TaskName "ConstructIQ-Backup-*" | Select-Object TaskName, State
schtasks /query /tn ConstructIQ-Backup-Daily /v /fo list
```

## 6. Run the first full backup

```powershell
schtasks /run /tn ConstructIQ-Backup-Weekly
```

Check `backend\backup\logs\backup-<yyyy-MM>.log` for the run, and confirm a `WeeklyFull` row appears with `LocalSuccess=true` (and `CloudSuccess=true` once Step 4 is complete) via the admin UI: **Settings → Backup & Disaster Recovery**.

## 7. Verify incrementals

Let the daily schedule run once (or trigger manually via `schtasks /run /tn ConstructIQ-Backup-Daily`), then check the status panel shows a "Latest incremental recovery point" newer than the full backup. The automated harness (`Test-BackupRestore.ps1`, see below) exercises this exact path — insert/update/delete on a table, confirm the incremental captures all three — against disposable data, and passed 15/15 checks during development.

## 8. Perform an isolated test restore

**Never restore over the live database.** Both scripts refuse a target name matching the live `DB_NAME`.

```powershell
$env:DB_PASSWORD = "<the app's own admin DB password>"
.\backend\backup\scripts\Restore-Local.ps1 -TargetDbName ciq_dr_test -TargetUploadsPath C:\temp\dr-test-uploads -Confirm
```

This restores the latest chain (weekly full + every incremental since) into a brand-new database and folder, replaying binary logs in order, and logs a row-count sanity check. Compare data against the live database, then drop the test database when done:
```sql
DROP DATABASE ciq_dr_test;
```

To restore from the cloud copy specifically (proving Copy 3 stands on its own — the real test of "recovery without the local repository"):
```powershell
.\backend\backup\scripts\Restore-Cloud.ps1 -TargetDbName ciq_dr_test2 -TargetUploadsPath C:\temp\dr-test-uploads2 -Confirm
```

## 9. Recovering on a clean/replacement host

1. Install MySQL 8.0, restic, and the MySQL client tools.
2. Copy this repository (or at minimum `backend\backup\scripts\`) to the new host.
3. Restore the five secret files (`mysql-backup-user-password.txt`, `restic-password.txt`, `backup-report-token.txt`, `b2-key-id.txt`, `b2-application-key.txt`) into a fresh `BACKUP_SECRETS_DIR` — **this is why the off-site copy of `restic-password.txt` from Step 4.6 is mandatory**; without it, the cloud repository's contents are permanently unreadable.
4. Set `backend\backup\backup.env` with `BACKUP_S3_*` pointing at the existing cloud bucket (no local device needed — this scenario assumes the original server, and possibly its local drive, are gone).
5. Run `Restore-Cloud.ps1` targeting the real production database name and uploads path (only ever do this deliberately, with `-Confirm`, understanding it creates a **new** database — promoting it to be the live one, e.g. renaming or repointing the app's `DB_NAME`, is a separate, explicit step you take after verifying the restored data).
6. Re-run `Setup-BackupMySqlUser.ps1` on the new host to establish a fresh backup identity, and `Register-BackupSchedule.ps1` to resume scheduled backups.

## 10. Routine administrator responsibilities

- **Weekly**: glance at Settings → Backup & Disaster Recovery. Confirm "3-2-1 arrangement complete" and that the last local/cloud/full timestamps are recent.
- **Monthly**: perform a real test restore (Step 8) and actually open the restored data — an upload succeeding is not proof a restore works.
- **Quarterly**: rotate the `constructiq_backup` MySQL password (`Setup-BackupMySqlUser.ps1` is idempotent and safe to re-run) and the cloud access key.
- **On any failed job** shown in the status panel: read the sanitized error message there first; full detail is in `backend\backup\logs\`. A cloud failure with local success still means Copy 1 and 2 are safe — treat it as urgent, not catastrophic.
- **Never** let `backend\backup\secrets\` (or wherever it's relocated to) be included in any backup destination it protects, synced to a personal cloud drive, or committed to source control.

---

## Reference: what's implemented vs. what needs your action

| Piece | State |
|---|---|
| Weekly full (`mysqldump --single-transaction`) | Implemented, tested against live data |
| Daily incremental (binlog archive + replay) | Implemented, tested (insert/update/delete captured correctly) |
| Encryption (restic, AES-256) | Implemented, tested (wrong-password rejection verified) |
| Local repository (Copy 2) | Implemented and tested — **against a folder on this disk, not yet a real external device** |
| Cloud repository (Copy 3) | Implemented; credentials and bucket permissions (init/write/read/delete/lock-cleanup/integrity) verified end-to-end against the real Backblaze B2 bucket with disposable data (2026-09-30) — **a real Weekly/Daily job with actual data has not yet run against it**, see Step 6 |
| Retention (whole-chain pruning) | Implemented (`Invoke-BackupRetention`, tag-based) — not exercised under real multi-week data |
| Locking against overlapping runs | Implemented and tested |
| Isolated restore (local + cloud) | Implemented and tested — full+incremental chain replay verified byte-for-byte on uploads, row-for-row on the database |
| Admin status/history UI | Implemented; API contract verified by code review and the automated report-endpoint test; **not click-tested in a browser** |
| Scheduled tasks | Registered on the build host under a **user logon** (needs elevated re-registration for SYSTEM/service-account logon in production) |
| Audit logging | Implemented, reusing the existing `ActivityLogs` table |
