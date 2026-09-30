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
var connStr = $"Server={builder.Configuration["DB_HOST"] ?? "localhost"};" +
              $"Port={builder.Configuration["DB_PORT"] ?? "3306"};" +
              $"Database={builder.Configuration["DB_NAME"] ?? "constructiq"};" +
              $"Uid={builder.Configuration["DB_USER"] ?? "root"};" +
              $"Pwd={builder.Configuration["DB_PASSWORD"]};";

builder.Services.AddDbContext<AppDbContext>(opts =>
    opts.UseMySql(connStr, new MySqlServerVersion(new Version(8, 0, 0))));

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
builder.Services.AddScoped<IWeatherGeocodingService, WeatherGeocodingService>();
builder.Services.AddHostedService<WeatherWatcherService>();
builder.Services.AddHttpClient("MLService", client =>
{
    client.BaseAddress = new Uri(builder.Configuration["ML_SERVICE_URL"] ?? "http://localhost:8000");
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
builder.Services.AddCors(opts =>
    opts.AddPolicy("FrontendPolicy", policy =>
        policy.WithOrigins(
                builder.Configuration["FRONTEND_URL"] ?? "http://localhost:3000")
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

app.UseStaticFiles(); // serves wwwroot/uploads/{projectId}/... for blueprint/BOQ previews
app.UseCors("FrontendPolicy");
app.UseStaticFiles(); // serves wwwroot/uploads/avatars/* publicly, e.g. GET /uploads/avatars/8.jpg
app.UseMiddleware<ActivityLoggingMiddleware>();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

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

app.Run();
