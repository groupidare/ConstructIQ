# Clear excess and waste before reseeding

The deployed model uses **MySQL 8**, `AppDbContext`, and one combined
`ExcessWasteRecords` table for excess and waste. There are no separate
`ExcessRecords`, `WasteRecords`, or reconciliation tables in this model.

These operations delete only `ExcessWasteRecords`. They preserve redistribution
requests but set their nullable `SourceExcessWasteRecordId` to null, matching the
existing `ON DELETE SET NULL` relationship and avoiding links to reused IDs.
Projects, BOQItems, ForecastResults, Users, materials, inventory, and all other
master data are untouched. General activity logs and notifications are retained;
they are not excess/waste transaction tables. Review any historical textual ID
references when reusing IDs. Outstanding redistribution requests are also retained;
this is a log reset, not an undo of prior transfers.

**BOQItems.ActualQuantity is deliberately unchanged**, even where previously
calculated from excess/waste. Therefore this does not reset calculated usage or
forecast output. Resetting those values would violate the requested safeguard.

## C# / current MySQL application

Stop all application instances and background writers. Use a fresh scope in an
explicit maintenance/seeding run, before starting request handling or new seeds:

```csharp
using ConstructIQ.API.Data;

await using var scope = app.Services.CreateAsyncScope();
var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
var result = await ExcessWasteCleanup.ClearExcessAndWasteAsync(db);
// Seed new excess/waste records only after successful completion.
```

The helper is not wired into ordinary startup and must not run on every restart.
It rejects a tracked context or outer transaction. Deletion and reference
detachment are transactional. MySQL's `ALTER TABLE ... AUTO_INCREMENT = 1`
implicitly commits, so resetting the counter happens separately after commit.
If that step fails, the exception explicitly reports that deletion already
committed. Keep writers stopped and rerun before seeding. The next generated ID
is 1 under the application's standard auto-increment configuration.

## Direct SQL

- `clear-excess-waste.mysql.sql`: current application, selected database.
- `clear-excess-waste.postgresql.sql`: equivalent PostgreSQL model, `public` schema.
- `clear-excess-waste.sqlserver.sql`: equivalent SQL Server model, `dbo` schema.

The latter two are provider-specific equivalents, not migrations or scripts to
run against MySQL. Confirm actual mapped identifiers and foreign keys before
using them on a migrated database. PostgreSQL and SQL Server keep deletion and
counter reset in one transaction. Foreign-key enforcement stays enabled; no
`TRUNCATE CASCADE`, table drops, or constraint disabling is used.

Run the scripts with stop-on-error behavior. Test on a disposable database copy:
check an empty log table, next generated ID 1, null source links with transfer rows
preserved, and unchanged master rows/BOQ quantities. Also exercise an empty-table
rerun and transaction rollback. Do not seed until cleanup succeeds.

Automated MySQL checks are in `backend/ConstructIQ.MaintenanceChecks`. Set
`CONSTRUCTIQ_CLEANUP_TEST_CONNECTION` to a test-server connection with CREATE/DROP
DATABASE privileges, then run that project. It creates a randomly named schema,
tests the helper and MySQL script with minimal relational fixtures, and drops
only that schema in `finally`. It also verifies rollback using a failing DELETE
trigger. These checks passed locally; the PostgreSQL and SQL Server scripts have
not been executed in this environment.

References: [MySQL implicit commits](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html),
[PostgreSQL sequence restart](https://www.postgresql.org/docs/16/sql-altersequence.html),
[SQL Server identity reseeding](https://learn.microsoft.com/en-us/sql/t-sql/database-console-commands/dbcc-checkident-transact-sql).
