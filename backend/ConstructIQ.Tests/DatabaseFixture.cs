using ConstructIQ.API.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using MySqlConnector;

namespace ConstructIQ.Tests;

// One scratch MySQL database, shared by every test in the "Database"
// collection, created fresh and dropped afterward — same pattern proven in
// ConstructIQ.SecurityChecks/Program.cs. Uses the local dev DB connection
// settings (or CONSTRUCTIQ_TEST_CONNECTION), never touches the real app DB.
public class DatabaseFixture : IAsyncLifetime
{
    private MySqlConnectionStringBuilder _adminConnection = null!;
    private string _database = null!;
    public DbContextOptions<AppDbContext> Options { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        var root = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (!Directory.Exists(Path.Combine(root.FullName, "ConstructIQ.API")))
            root = root.Parent ?? throw new InvalidOperationException("Run from within the backend workspace.");
        var local = new ConfigurationBuilder().SetBasePath(Path.Combine(root.FullName, "ConstructIQ.API"))
            .AddJsonFile("appsettings.json", optional: true).AddJsonFile("appsettings.Development.json", optional: true).Build();

        var connection = new MySqlConnectionStringBuilder(Environment.GetEnvironmentVariable("CONSTRUCTIQ_TEST_CONNECTION") ?? "")
        {
            Server = local["DB_HOST"] ?? "localhost", UserID = local["DB_USER"] ?? "root",
            Password = local["DB_PASSWORD"] ?? "", Port = uint.Parse(local["DB_PORT"] ?? "3306"),
        };
        if (Environment.GetEnvironmentVariable("CONSTRUCTIQ_TEST_CONNECTION") is { } explicitConnection)
            connection = new MySqlConnectionStringBuilder(explicitConnection);

        _database = "ciq_forecast_test_" + Guid.NewGuid().ToString("N")[..16];
        _adminConnection = new MySqlConnectionStringBuilder(connection.ConnectionString) { Database = "" };

        await using var admin = new MySqlConnection(_adminConnection.ConnectionString);
        await admin.OpenAsync();
        await using (var create = admin.CreateCommand())
        { create.CommandText = $"CREATE DATABASE `{_database}`"; await create.ExecuteNonQueryAsync(); }

        connection.Database = _database;
        Options = new DbContextOptionsBuilder<AppDbContext>()
            .UseMySql(connection.ConnectionString, new MySqlServerVersion(new Version(8, 0, 0)))
            .Options;

        await using var db = new AppDbContext(Options);
        await db.Database.MigrateAsync();
    }

    public AppDbContext CreateContext() => new(Options);

    public async Task DisposeAsync()
    {
        MySqlConnection.ClearAllPools();
        if (!System.Text.RegularExpressions.Regex.IsMatch(_database, "^ciq_forecast_test_[a-f0-9]{16}$"))
            throw new InvalidOperationException("Unsafe test database name — refusing to drop.");
        await using var admin = new MySqlConnection(_adminConnection.ConnectionString);
        await admin.OpenAsync();
        await using var drop = admin.CreateCommand();
        drop.CommandText = $"DROP DATABASE `{_database}`";
        await drop.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition("Database")]
public class DatabaseCollection : ICollectionFixture<DatabaseFixture>;
