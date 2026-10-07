using ConstructIQ.API.Helpers;
using System.Text;
using ConstructIQ.API.Data;
using ConstructIQ.API.Middleware;
using ConstructIQ.API.Services;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// ── Database ────────────────────────────────────────────────────────────────
// SslMode defaults to "Preferred" (MySqlConnector's own default: opportunistic
// TLS, works unchanged against a local dev MySQL with no SSL configured) — set
// DB_SSL_MODE=Required (or VerifyCA/VerifyFull) via env var for a managed host
// like Aiven that enforces TLS.
var connStr = $"Server={builder.Configuration["DB_HOST"] ?? "localhost"};" +
              $"Port={builder.Configuration["DB_PORT"] ?? "3306"};" +
              $"Database={builder.Configuration["DB_NAME"] ?? "constructiq"};" +
              $"Uid={builder.Configuration["DB_USER"] ?? "root"};" +
              $"Pwd={builder.Configuration["DB_PASSWORD"]};" +
              $"SslMode={builder.Configuration["DB_SSL_MODE"] ?? "Preferred"};" +
              // MySqlConnector allows up to 100 pooled connections by default —
              // more than a small managed MySQL plan (Aiven) accepts in total,
              // shared with the ML service. Capped so the backend can't use up
              // the server's limit ("Too many connections"); requests briefly
              // wait for a free connection instead. Override with DB_MAX_POOL_SIZE.
              $"Maximum Pool Size={builder.Configuration["DB_MAX_POOL_SIZE"] ?? "15"};";

builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseMySql(connStr, new MySqlServerVersion(new Version(8, 0, 0)), mysql =>
        // A brief connection blip to Aiven (network hiccup, not a real
        // outage) used to surface as a raw 500 straight to the user instead
        // of just quietly retrying — this is EF Core's own built-in retry
        // policy for exactly that class of transient failure.
        mysql.EnableRetryOnFailure(maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(5), errorNumbersToAdd: null)));

// ── JWT Authentication ───────────────────────────────────────────────────────
builder.Services.AddConstructIqSecurity(builder.Configuration);

// ── Services ─────────────────────────────────────────────────────────────────
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IEmailService, EmailService>();
builder.Services.AddScoped<DatabaseBackupService>();
builder.Services.AddScoped<IProjectService, ProjectService>();
builder.Services.AddScoped<IProjectAccessService, ProjectAccessService>();
builder.Services.AddScoped<IInventoryService, InventoryService>();
builder.Services.AddScoped<IExcessWasteService, ExcessWasteService>();
builder.Services.AddScoped<IForecastService, ForecastService>();
builder.Services.AddScoped<IProcurementService, ProcurementService>();
builder.Services.AddScoped<IRedistributionService, RedistributionService>();
builder.Services.AddScoped<IWarehouseRequestService, WarehouseRequestService>();
builder.Services.AddScoped<IDocumentService, DocumentService>();
builder.Services.AddScoped<IMeasurementService, MeasurementService>();
builder.Services.AddScoped<IBOQService, BOQService>();
builder.Services.AddScoped<INotificationService, NotificationService>();
builder.Services.AddScoped<IBackupJobService, BackupJobService>();
builder.Services.AddScoped<IPhaseService, PhaseService>();
builder.Services.AddScoped<IWarehouseStockService, WarehouseStockService>();
builder.Services.AddSingleton<IFileStorageService, R2FileStorageService>();
builder.Services.AddScoped<IWeatherGeocodingService, WeatherGeocodingService>();
builder.Services.AddHostedService<WeatherWatcherService>();
builder.Services.AddHttpClient("MLService", client =>
{
    client.BaseAddress = new Uri(builder.Configuration["ML_SERVICE_URL"] ?? "http://localhost:8000");
    // ml-service runs as a public Web Service (Render's free tier has no
    // Private Service option), so this proves the request actually came from
    // this backend rather than an arbitrary caller — see ml-service's
    // app/utils/auth.py, which only enforces this when ML_API_KEY is set
    // (unset for local dev, where there's nothing public to protect).
    var mlApiKey = builder.Configuration["ML_API_KEY"];
    if (!string.IsNullOrWhiteSpace(mlApiKey))
        client.DefaultRequestHeaders.Add("X-API-Key", mlApiKey);
});
builder.Services.AddHostedService<MlServiceKeepAliveService>();
builder.Services.AddHostedService<DbKeepAliveService>();
builder.Services.AddHttpClient("Resend", client =>
{
    client.BaseAddress = new Uri("https://api.resend.com/");
    var resendKey = builder.Configuration["RESEND_API_KEY"];
    if (!string.IsNullOrWhiteSpace(resendKey))
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", resendKey);
});
builder.Services.AddHttpClient("GoogleSheets", client =>
{
    client.BaseAddress = new Uri("https://sheets.googleapis.com/");
});
builder.Services.AddHttpClient("OpenMeteoGeocoding", client =>
{
    client.BaseAddress = new Uri("https://geocoding-api.open-meteo.com/");
});
builder.Services.AddHttpClient("OpenMeteoWeather", client =>
{
    client.BaseAddress = new Uri("https://api.open-meteo.com/");
});

// ── CORS ─────────────────────────────────────────────────────────────────────
var frontendOrigins = (builder.Configuration["FRONTEND_URL"] ?? "http://localhost:3000")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(opts =>
    opts.AddPolicy("FrontendPolicy", policy =>
        policy.WithOrigins(frontendOrigins)
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials()));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// No app.UseStaticFiles() — uploads now live on Cloudflare R2 (see
// R2FileStorageService), served directly to the browser from there, not
// proxied through this app's own (ephemeral, Render-free-tier) disk.
app.UseCors("FrontendPolicy");
app.UseMiddleware<ActivityLoggingMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Unauthenticated on purpose — an external uptime monitor (BetterStack etc.)
// needs to hit this without credentials to keep the free-tier instance from
// idling out, which otherwise resets the container's filesystem on wake-up.
app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "ConstructIQ API" }));

// Apply pending migrations and seed admin user
using (var scope = app.Services.CreateScope())
{
    try
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Database.Migrate();
        var admin = db.Users.FirstOrDefault(u => u.Username == "admin");
        if (admin is null)
        {
            db.Users.Add(new ConstructIQ.API.Models.Entities.User
            {
                Username     = "admin",
                Email        = "admin@constructiq.com",
                PasswordHash = ConstructIQ.API.Helpers.PasswordHasher.Hash("Admin@123"),
                FirstName    = "System",
                LastName     = "Administrator",
                Role         = ConstructIQ.API.Models.Entities.UserRole.Admin,
                IsActive     = true,
            });
        }

        db.SaveChanges();
    }
    catch (Exception ex) { Console.WriteLine($"[SEEDER ERROR] {ex.Message}"); }
}

// One-off historical data backfill for the Forecasting chart: `dotnet run
// --seed-excess` runs it and exits, never as part of a normal app start.
if (args.Contains("--seed-excess"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await ConstructIQ.API.Data.DbInitializer.SeedHistoricalExcessAndWasteAsync(db);
    return;
}

if (args.Contains("--seed-forecasts"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await ConstructIQ.API.Data.DbInitializer.SeedHistoricalForecastsAsync(db);
    return;
}

// One-off: gives existing historical BOQ rows the purchase quantity/unit of
// their own PO lines (see DbInitializer.BackfillHistoricalPurchaseUnitsAsync).
// Opt-in only — `dotnet run --backfill-historical-purchase-units` runs it,
// prints every row it changed, and exits.
if (args.Contains("--backfill-historical-purchase-units"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await ConstructIQ.API.Data.DbInitializer.BackfillHistoricalPurchaseUnitsAsync(db);
    return;
}

// One-off: removes saved forecasts no trained model produced (see
// DbInitializer.CleanupFallbackForecastsAsync). `dotnet run
// --cleanup-fallback-forecasts` only lists them; add `--confirm` to delete.
if (args.Contains("--cleanup-fallback-forecasts"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await ConstructIQ.API.Data.DbInitializer.CleanupFallbackForecastsAsync(db, confirm: args.Contains("--confirm"));
    return;
}

app.Run();
