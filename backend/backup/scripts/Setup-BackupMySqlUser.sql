-- Reference copy of the grant Setup-BackupMySqlUser.ps1 actually issues.
-- Never run this file directly with a real password pasted in — it exists
-- so the exact privilege set is reviewable in source control without the
-- secret ever being committed. Use Setup-BackupMySqlUser.ps1 instead, which
-- generates the password itself and writes it only to BACKUP_SECRETS_DIR
-- (outside this repo).
--
-- Minimum privileges for: mysqldump --single-transaction --source-data=2
-- (weekly full), FLUSH BINARY LOGS / SHOW BINARY LOGS / SHOW MASTER STATUS,
-- and mysqlbinlog --read-from-remote-server --raw (daily incremental
-- archiving over the MySQL protocol, avoiding any OS filesystem permission
-- on the datadir). Deliberately excludes INSERT, UPDATE, DELETE, DROP,
-- ALTER, CREATE, SUPER, GRANT OPTION - this identity can read and dump
-- data and archive binlogs, never modify application data or grant itself
-- more access.

CREATE USER IF NOT EXISTS 'constructiq_backup'@'localhost' IDENTIFIED BY '{{BACKUP_MYSQL_PASSWORD}}';

GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER, RELOAD, REPLICATION CLIENT, REPLICATION SLAVE
    ON *.* TO 'constructiq_backup'@'localhost';

FLUSH PRIVILEGES;
