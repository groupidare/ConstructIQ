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
var jwtSecret = builder.Configuration["JWT_SECRET"]
    ?? throw new InvalidOperationException("JWT_SECRET not configured.");

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opts =>
    {
        opts.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidateAudience         = true,
            ValidateLifetime         = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer              = builder.Configuration["JWT_ISSUER"],
            ValidAudience            = builder.Configuration["JWT_AUDIENCE"],
            IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
        };
    });

builder.Services.AddAuthorization();

// ── Services ─────────────────────────────────────────────────────────────────
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IEmailService, EmailService>();
builder.Services.AddScoped<IProjectService, ProjectService>();
builder.Services.AddScoped<IInventoryService, InventoryService>();
builder.Services.AddScoped<IExcessWasteService, ExcessWasteService>();
builder.Services.AddScoped<IForecastService, ForecastService>();
builder.Services.AddScoped<IProcurementService, ProcurementService>();
builder.Services.AddScoped<IRedistributionService, RedistributionService>();
builder.Services.AddHttpClient("MLService", client =>
{
    client.BaseAddress = new Uri(builder.Configuration["ML_SERVICE_URL"] ?? "http://localhost:8000");
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

// TEMP debug endpoints
app.MapGet("/dev/hash", () => BCrypt.Net.BCrypt.HashPassword("Admin@123"));
app.MapGet("/dev/debug", (AppDbContext db) =>
{
    try
    {
        var admin = db.Users.FirstOrDefault(u => u.Username == "admin");
        if (admin is null) return Results.Ok("NO ADMIN USER IN DATABASE");
        var hashOk = BCrypt.Net.BCrypt.Verify("Admin@123", admin.PasswordHash);
        return Results.Ok(new {
            Found      = true,
            IsActive   = admin.IsActive,
            Role       = admin.Role.ToString(),
            HashOk     = hashOk,
            HashStored = admin.PasswordHash
        });
    }
    catch (Exception ex) { return Results.Ok($"DB ERROR: {ex.Message}"); }
});

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
        else
        {
            admin.PasswordHash = ConstructIQ.API.Helpers.PasswordHasher.Hash("Admin@123");
            admin.IsActive     = true;
            admin.Role         = ConstructIQ.API.Models.Entities.UserRole.Admin;
        }
        db.SaveChanges();
    }
    catch (Exception ex) { Console.WriteLine($"[SEEDER ERROR] {ex.Message}"); }
}

app.Run();
