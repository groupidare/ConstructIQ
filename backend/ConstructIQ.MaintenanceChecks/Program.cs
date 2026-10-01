using ConstructIQ.API.Data;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;

// Requires CREATE/DROP DATABASE privileges. Never operates on the supplied database:
// all fixtures and mutations are confined to a newly created random test schema.
var connectionString = Environment.GetEnvironmentVariable("CONSTRUCTIQ_CLEANUP_TEST_CONNECTION")
    ?? throw new InvalidOperationException("Set CONSTRUCTIQ_CLEANUP_TEST_CONNECTION to a MySQL test server connection string.");
var builder = new MySqlConnectionStringBuilder(connectionString) { Database = "", Pooling = false };
await using var admin = new MySqlConnection(builder.ConnectionString);
await admin.OpenAsync();
var schema = "constructiq_cleanup_check_" + Guid.NewGuid().ToString("N");
await new MySqlCommand($"CREATE DATABASE `{schema}`", admin).ExecuteNonQueryAsync();
try
{
    builder.Database = schema;
    await using var connection = new MySqlConnection(builder.ConnectionString);
    await connection.OpenAsync();
    async Task Execute(string sql) => await new MySqlCommand(sql, connection).ExecuteNonQueryAsync();
    async Task<long> Scalar(string sql) => Convert.ToInt64(await new MySqlCommand(sql, connection).ExecuteScalarAsync());
    static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    foreach (var table in new[] { "Projects", "BOQItems", "ForecastResults", "Users", "Materials" })
    {
        await Execute($"CREATE TABLE `{table}` (Id int PRIMARY KEY, PreservedValue int NOT NULL) ENGINE=InnoDB");
        await Execute($"INSERT INTO `{table}` VALUES (1, 777)");
    }
    await Execute("CREATE TABLE ExcessWasteRecords (Id int PRIMARY KEY AUTO_INCREMENT, ProjectId int, BOQItemId int, Quantity decimal(18,4), FOREIGN KEY (ProjectId) REFERENCES Projects(Id), FOREIGN KEY (BOQItemId) REFERENCES BOQItems(Id)) ENGINE=InnoDB");
    await Execute("CREATE TABLE RedistributionRequests (Id int PRIMARY KEY, SourceExcessWasteRecordId int NULL, PreservedValue int NOT NULL, FOREIGN KEY (SourceExcessWasteRecordId) REFERENCES ExcessWasteRecords(Id) ON DELETE SET NULL) ENGINE=InnoDB");
    await Execute("INSERT INTO ExcessWasteRecords VALUES (40,1,1,5),(41,1,1,10)");
    await Execute("INSERT INTO RedistributionRequests VALUES (1,40,888),(2,NULL,999)");
    var options = new DbContextOptionsBuilder<AppDbContext>()
        .UseMySql(builder.ConnectionString, new MySqlServerVersion(new Version(8, 0, 0))).Options;

    // Deliberately fail deletion after the update; the link must be rolled back.
    await Execute("CREATE TRIGGER reject_cleanup BEFORE DELETE ON ExcessWasteRecords FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Expected rollback test'");
    await using (var db = new AppDbContext(options))
    {
        var failed = false;
        try { await ExcessWasteCleanup.ClearExcessAndWasteAsync(db); }
        catch (MySqlException) { failed = true; }
        Check(failed, "Expected the delete trigger to reject cleanup.");
    }
    Check(await Scalar("SELECT COUNT(*) FROM ExcessWasteRecords") == 2, "Rollback lost log rows.");
    Check(await Scalar("SELECT SourceExcessWasteRecordId FROM RedistributionRequests WHERE Id=1") == 40, "Rollback lost source link.");
    await Execute("DROP TRIGGER reject_cleanup");

    await using (var db = new AppDbContext(options))
    {
        var result = await ExcessWasteCleanup.ClearExcessAndWasteAsync(db);
        Check(result.DeletedRecords == 2 && result.DetachedRedistributionLinks == 1, "Incorrect cleanup counts.");
    }
    Check(await Scalar("SELECT COUNT(*) FROM ExcessWasteRecords") == 0, "Logs remain.");
    Check(await Scalar("SELECT COUNT(*) FROM RedistributionRequests WHERE SourceExcessWasteRecordId IS NULL") == 2, "Transfer history not preserved/detached.");
    Check(await Scalar("SELECT SUM(PreservedValue) FROM RedistributionRequests") == 1887, "Transfer fields changed.");
    foreach (var table in new[] { "Projects", "BOQItems", "ForecastResults", "Users", "Materials" })
        Check(await Scalar($"SELECT COUNT(*) FROM `{table}` WHERE Id=1 AND PreservedValue=777") == 1, $"Master {table} changed.");

    await using (var db = new AppDbContext(options))
    {
        var result = await ExcessWasteCleanup.ClearExcessAndWasteAsync(db);
        Check(result.DeletedRecords == 0 && result.DetachedRedistributionLinks == 0, "Empty rerun failed.");
    }
    await Execute("INSERT INTO ExcessWasteRecords (ProjectId, BOQItemId, Quantity) VALUES (1,1,3)");
    Check(await Scalar("SELECT Id FROM ExcessWasteRecords") == 1, "Next ID was not reset to 1.");

    // Also exercise the checked-in MySQL script against the same isolated fixtures.
    var scriptPath = Path.Combine(AppContext.BaseDirectory, "clear-excess-waste.mysql.sql");
    await Execute(await File.ReadAllTextAsync(scriptPath));
    await Execute("INSERT INTO ExcessWasteRecords (ProjectId, BOQItemId, Quantity) VALUES (1,1,3)");
    Check(await Scalar("SELECT Id FROM ExcessWasteRecords") == 1, "SQL script failed to reset ID.");
    Console.WriteLine("PASS: rollback, preserved masters/transfers, deletion counts, empty rerun, ID reset, MySQL SQL script.");
}
finally
{
    // schema is generated above, never derived from the caller's database name.
    await new MySqlCommand($"DROP DATABASE `{schema}`", admin).ExecuteNonQueryAsync();
}
