using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Data;
using ConstructIQ.API.Helpers;
using ConstructIQ.API.Middleware;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;

try { await RunChecks(); }
catch (Exception ex) { Console.Error.WriteLine(ex); Environment.ExitCode = 1; }

static async Task RunChecks()
{
// Run from the repository root. Only the randomly named test database is changed.
// Uses existing local DB connection settings, or CONSTRUCTIQ_TEST_CONNECTION.
var root = new DirectoryInfo(Directory.GetCurrentDirectory());
while (!Directory.Exists(Path.Combine(root.FullName, "backend", "ConstructIQ.API")))
    root = root.Parent ?? throw new InvalidOperationException("Run inside the ConstructIQ workspace.");
var local = new ConfigurationBuilder().SetBasePath(Path.Combine(root.FullName, "backend", "ConstructIQ.API"))
    .AddJsonFile("appsettings.json", optional: true).AddJsonFile("appsettings.Development.json", optional: true).Build();
var connection = new MySqlConnectionStringBuilder(Environment.GetEnvironmentVariable("CONSTRUCTIQ_TEST_CONNECTION") ?? "")
{
    Server = local["DB_HOST"] ?? "localhost", UserID = local["DB_USER"] ?? "root",
    Password = local["DB_PASSWORD"] ?? "", Port = uint.Parse(local["DB_PORT"] ?? "3306"),
};
if (Environment.GetEnvironmentVariable("CONSTRUCTIQ_TEST_CONNECTION") is { } explicitConnection)
    connection = new MySqlConnectionStringBuilder(explicitConnection);
var database = "ciq_security_test_" + Guid.NewGuid().ToString("N")[..16];
connection.Database = "";
await using var adminConnection = new MySqlConnection(connection.ConnectionString);
await adminConnection.OpenAsync();
await using (var create = adminConnection.CreateCommand())
{ create.CommandText = $"CREATE DATABASE `{database}`"; await create.ExecuteNonQueryAsync(); }
connection.Database = database;
var options = new DbContextOptionsBuilder<AppDbContext>().UseMySql(connection.ConnectionString, new MySqlServerVersion(new Version(8, 0, 0))).Options;
WebApplication? app = null;
try
{
    await using (var db = new AppDbContext(options))
    {
        await db.Database.MigrateAsync();
        db.Users.AddRange(
            new User { Username = "security-admin", Email = "admin@example.test", PasswordHash = PasswordHasher.Hash("OriginalPassword1!"), FirstName = "Test", LastName = "Admin", Role = UserRole.Admin },
            new User { Username = "security-user", Email = "user@example.test", PasswordHash = PasswordHasher.Hash("OriginalPassword1!"), FirstName = "Test", LastName = "User", Role = UserRole.SiteEngineer });
        await db.SaveChangesAsync();
    }
    var builder = WebApplication.CreateBuilder();
    builder.Logging.ClearProviders();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    { ["JWT_SECRET"] = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)), ["JWT_ISSUER"] = "SecurityChecks", ["JWT_AUDIENCE"] = "SecurityChecks" });
    builder.Services.AddDbContext<AppDbContext>(o => o.UseMySql(connection.ConnectionString, new MySqlServerVersion(new Version(8, 0, 0))));
    builder.Services.AddConstructIqSecurity(builder.Configuration);
    builder.Services.AddHttpContextAccessor();
    var mail = new CapturedEmail();
    builder.Services.AddSingleton<IEmailService>(mail);
    builder.Services.AddScoped<IAuthService, AuthService>();
    builder.Services.AddScoped<DatabaseBackupService>();
    builder.Services.AddControllers().AddApplicationPart(typeof(AccountSecurityController).Assembly);
    app = builder.Build();
    app.UseMiddleware<ActivityLoggingMiddleware>();
    app.UseAuthentication(); app.UseAuthorization(); app.MapControllers();
    await app.StartAsync();
    using var client = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
    async Task<string> Token(int id)
    { await using var db = new AppDbContext(options); return JwtHelper.GenerateToken((await db.Users.FindAsync(id))!, builder.Configuration); }
    void Auth(string token) => client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    void Check(bool condition, string message) { if (!condition) throw new Exception("FAILED: " + message); Console.WriteLine("PASS: " + message); }
    async Task<HttpResponseMessage> Post(string path, object? body = null) => await client.PostAsJsonAsync(path, body ?? new { });
    async Task<JsonElement> Json(HttpResponseMessage response) => JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
    async Task ResetChallenge()
    {
        await using var db = new AppDbContext(options);
        await db.Users.Where(u => u.Id == 1).ExecuteUpdateAsync(s => s.SetProperty(u => u.PasswordChangeRequestedAt, (DateTime?)null));
    }
    async Task<string> Grant()
    {
        await ResetChallenge();
        Check((await Post("/api/v1/auth/change-password/request-otp")).IsSuccessStatusCode, "OTP request succeeds");
        var response = await Post("/api/v1/auth/change-password/verify-otp", new { code = mail.Code });
        Check(response.IsSuccessStatusCode, "Correct OTP verifies");
        return (await Json(response)).GetProperty("password_change_token").GetString()!;
    }

    Check((await client.GetAsync("/api/v1/activity-logs")).StatusCode == HttpStatusCode.Unauthorized, "Anonymous activity access denied");
    Check((await Post("/api/v1/auth/change-password/request-otp")).StatusCode == HttpStatusCode.Unauthorized, "Anonymous password change denied");
    Auth(await Token(2));
    Check((await client.GetAsync("/api/v1/activity-logs")).StatusCode == HttpStatusCode.Forbidden, "Non-admin activity access denied");
    Check((await Post("/api/v1/system/backup")).StatusCode == HttpStatusCode.Forbidden, "Non-admin backup denied");
    using (var form = new MultipartFormDataContent())
    {
        form.Add(new ByteArrayContent([]), "file", "x.json"); form.Add(new StringContent("RESTORE"), "confirmation");
        Check((await client.PostAsync("/api/v1/system/restore", form)).StatusCode == HttpStatusCode.Forbidden, "Non-admin restore denied");
    }
    Auth(await Token(1));
    Check((await Post("/api/v1/auth/change-password", new { passwordChangeToken = "invalid", newPassword = "StrongNewPassword1!", confirmPassword = "StrongNewPassword1!" })).StatusCode == HttpStatusCode.BadRequest, "Password cannot change without step-up grant");
    Check((await Post("/api/v1/auth/mfa/enable")).IsSuccessStatusCode, "MFA enable succeeds");
    Check((await Json(await client.GetAsync("/api/v1/auth/mfa"))).GetProperty("isMfaEnabled").GetBoolean(), "MFA setting persists across requests");
    Check((await Post("/api/v1/auth/mfa/disable")).IsSuccessStatusCode, "MFA disable succeeds");
    Check(!(await Json(await client.GetAsync("/api/v1/auth/mfa"))).GetProperty("isMfaEnabled").GetBoolean(), "MFA disable persists");

    var grant = await Grant();
    Check((await Post("/api/v1/auth/change-password/verify-otp", new { code = mail.Code })).StatusCode == HttpStatusCode.BadRequest, "OTP cannot be reused");
    Auth(await Token(2));
    Check((await Post("/api/v1/auth/change-password", new { passwordChangeToken = grant, newPassword = "StrongNewPassword1!", confirmPassword = "StrongNewPassword1!" })).StatusCode == HttpStatusCode.BadRequest, "Grant is bound to its user");
    Auth(await Token(1));
    Check((await Post("/api/v1/auth/change-password", new { passwordChangeToken = grant, newPassword = "short", confirmPassword = "short" })).StatusCode == HttpStatusCode.BadRequest, "Short passwords rejected");
    Check((await Post("/api/v1/auth/change-password", new { passwordChangeToken = grant, newPassword = "StrongNewPassword1!", confirmPassword = "DifferentPassword1!" })).StatusCode == HttpStatusCode.BadRequest, "Mismatched confirmation rejected");
    var changed = await Post("/api/v1/auth/change-password", new { passwordChangeToken = grant, newPassword = "StrongNewPassword1!", confirmPassword = "StrongNewPassword1!" });
    Check(changed.IsSuccessStatusCode, "Verified password change succeeds");
    Check((await client.GetAsync("/api/v1/auth/mfa")).StatusCode == HttpStatusCode.Unauthorized, "Old session revoked");
    Auth(await Token(1));
    Check((await Post("/api/v1/auth/change-password", new { passwordChangeToken = grant, newPassword = "AnotherPassword1!", confirmPassword = "AnotherPassword1!" })).StatusCode == HttpStatusCode.BadRequest, "Grant replay rejected after new sign-in");
    await using (var db = new AppDbContext(options)) Check(PasswordHasher.Verify("StrongNewPassword1!", (await db.Users.FindAsync(1))!.PasswordHash), "Password stored as a valid hash");

    await ResetChallenge(); await Post("/api/v1/auth/change-password/request-otp");
    Check((await Post("/api/v1/auth/change-password/request-otp")).StatusCode == HttpStatusCode.TooManyRequests, "OTP resend throttled");
    var wrong = mail.Code == "000000" ? "111111" : "000000";
    for (var i = 0; i < 5; i++) await Post("/api/v1/auth/change-password/verify-otp", new { code = wrong });
    Check((await Post("/api/v1/auth/change-password/verify-otp", new { code = mail.Code })).StatusCode == HttpStatusCode.BadRequest, "OTP locked after five failures");
    await ResetChallenge(); await Post("/api/v1/auth/change-password/request-otp");
    await using (var db = new AppDbContext(options)) await db.Users.Where(u => u.Id == 1).ExecuteUpdateAsync(s => s.SetProperty(u => u.PasswordChangeExpiresAt, DateTime.UtcNow.AddMinutes(-1)));
    Check((await Post("/api/v1/auth/change-password/verify-otp", new { code = mail.Code })).StatusCode == HttpStatusCode.BadRequest, "Expired OTP rejected");
    await ResetChallenge(); mail.Fail = true;
    Check((await Post("/api/v1/auth/change-password/request-otp")).StatusCode == HttpStatusCode.ServiceUnavailable, "Email failure does not claim success"); mail.Fail = false;

    var backup = await Post("/api/v1/system/backup");
    Check(backup.IsSuccessStatusCode && backup.Content.Headers.ContentDisposition?.DispositionType == "attachment", "Real backup attachment generated");
    var bytes = await backup.Content.ReadAsByteArrayAsync();
    Check((await Json(await client.GetAsync("/api/v1/system/backup"))).GetProperty("createdAt").ValueKind == JsonValueKind.String, "Real last-backup timestamp persisted");
    async Task<HttpResponseMessage> Restore(byte[] content)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new ByteArrayContent(content), "file", "backup.json"); form.Add(new StringContent("RESTORE"), "confirmation");
        return await client.PostAsync("/api/v1/system/restore", form);
    }
    var envelope = JsonSerializer.Deserialize<DatabaseBackupService.BackupEnvelope>(bytes)!;
    var badBytes = JsonSerializer.SerializeToUtf8Bytes(envelope with { Signature = new string('0', 64) });
    Check((await Restore(badBytes)).StatusCode == HttpStatusCode.BadRequest, "Tampered backup rejected");
    await using (var db = new AppDbContext(options)) await db.Users.Where(u => u.Id == 2).ExecuteUpdateAsync(s => s.SetProperty(u => u.FirstName, "ChangedAfterBackup"));
    var restore = await Restore(bytes);
    Check(restore.IsSuccessStatusCode, "Valid backup restores transactionally");
    Check((await client.GetAsync("/api/v1/activity-logs")).StatusCode == HttpStatusCode.Unauthorized, "Restore revokes pre-restore sessions");
    Auth(await Token(1));
    await using (var db = new AppDbContext(options))
    {
        Check((await db.Users.FindAsync(2))!.FirstName == "Test", "Restore restores actual database values");
        Check(await db.ActivityLogs.AnyAsync(l => l.Action == "DATABASE_RESTORED"), "Restore audit recorded");
    }
    var logs = await Json(await client.GetAsync("/api/v1/activity-logs?pageSize=1"));
    Check(logs.GetProperty("items").GetArrayLength() == 1 && logs.GetProperty("total").GetInt32() > 0, "Activity log returns real paginated data");
    Console.WriteLine("All security integration checks passed.");
}
finally
{
    if (app is not null) await app.DisposeAsync();
    MySqlConnection.ClearAllPools();
    if (!System.Text.RegularExpressions.Regex.IsMatch(database, "^ciq_security_test_[a-f0-9]{16}$")) throw new Exception("Unsafe test database name.");
    await using var drop = adminConnection.CreateCommand(); drop.CommandText = $"DROP DATABASE `{database}`"; await drop.ExecuteNonQueryAsync();
}

}

sealed class CapturedEmail : IEmailService
{
    public string Code { get; private set; } = "";
    public bool Fail { get; set; }
    public Task SendPasswordChangeCodeAsync(string email, string code)
    { if (Fail) throw new InvalidOperationException("Test email failure"); Code = code; return Task.CompletedTask; }
    public Task SendMfaCodeEmailAsync(string email, string name, string code, bool isNewDevice = false) { Code = code; return Task.CompletedTask; }
    public Task SendPasswordResetEmailAsync(string email, string name, string link) => Task.CompletedTask;
}
