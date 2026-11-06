using System.Net.Http.Json;
using System.Text.Json.Serialization;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Periodic background check standing in for real-time weather push: every 30
// minutes, checks each active project's real (geocoded) coordinates against
// Open-Meteo, using the same risk thresholds as the client-side weather chip
// (frontend/src/lib/weather.ts's assessConstructionRisk) so both sides agree
// on what counts as a delay risk.
public class WeatherWatcherService(IServiceScopeFactory scopeFactory, IHttpClientFactory httpFactory,
    ILogger<WeatherWatcherService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan WeatherDedupeWindow = TimeSpan.FromHours(6);
    private int _consecutiveFailures;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await RunCycleAsync(stoppingToken); }
            catch (Exception ex) { logger.LogError(ex, "Weather watcher cycle failed"); }
        }
        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RunCycleAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var notifications = scope.ServiceProvider.GetRequiredService<INotificationService>();

        await CheckWeatherAsync(db, notifications, ct);
        // No "overdue PO" sweep any more: a PO's delivery date is only the
        // system's estimate from the supplier's lead time, so passing it isn't
        // a delay. Late deliveries come from Warehouse's on-time rating.
    }

    private async Task CheckWeatherAsync(AppDbContext db, INotificationService notifications, CancellationToken ct)
    {
        var projects = await db.Projects
            .Where(p => p.Status == ProjectStatus.Active && p.Latitude != null && p.Longitude != null)
            .ToListAsync(ct);

        foreach (var project in projects)
        {
            OpenMeteoCurrent? current;
            try
            {
                var client = httpFactory.CreateClient("OpenMeteoWeather");
                var url = $"v1/forecast?latitude={project.Latitude}&longitude={project.Longitude}" +
                          "&current=precipitation,weather_code,wind_speed_10m&timezone=auto";
                var response = await client.GetFromJsonAsync<OpenMeteoResponse>(url, ct);
                current = response?.Current;
                _consecutiveFailures = 0;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Weather fetch failed for project {ProjectId}", project.Id);
                current = null;
                _consecutiveFailures++;
                if (_consecutiveFailures == 3)
                {
                    await notifications.CreateForRoleAsync(UserRole.Admin, NotificationKind.WeatherApiDown,
                        "The weather service has failed 3 checks in a row — site weather alerts may be delayed.",
                        createdByUserId: project.ProjectManagerId);
                    _consecutiveFailures = 0;
                }
                continue;
            }
            if (current is null) continue;

            var risk = AssessConstructionRisk(current.WeatherCode, current.Precipitation, current.WindSpeed10m);
            if (risk.Level is not ("high" or "extreme")) continue;

            var cutoff = DateTime.UtcNow - WeatherDedupeWindow;
            var alreadyNotified = await db.Notifications.AnyAsync(n =>
                n.Kind == NotificationKind.Weather && n.ProjectId == project.Id && n.CreatedAt > cutoff, ct);
            if (alreadyNotified) continue;

            var message = $"{risk.Headline} at {project.Name} ({project.Location}). {risk.Advisory}";
            await notifications.CreateForRoleAsync(UserRole.ProjectManager, NotificationKind.Weather, message,
                project.ProjectManagerId, projectId: project.Id, actionLink: $"/projects/{project.Id}");
            if (project.SiteEngineerId.HasValue)
                await notifications.CreateForRoleAsync(UserRole.SiteEngineer, NotificationKind.Weather, message,
                    project.ProjectManagerId, projectId: project.Id, actionLink: $"/projects/{project.Id}");
            // No facility-location concept exists for warehouses (see plan notes) —
            // every WarehousePersonnel gets every severe-weather alert, unscoped.
            await notifications.CreateForRoleAsync(UserRole.WarehousePersonnel, NotificationKind.Weather, message,
                project.ProjectManagerId, projectId: project.Id);
            await notifications.CreateForRoleAsync(UserRole.ProcurementOfficer, NotificationKind.Weather,
                $"{message} Potential delivery delays for this project's open purchase orders.",
                project.ProjectManagerId, projectId: project.Id, actionLink: "/procurement");
        }
    }

    private static (string Level, string Headline, string Advisory) AssessConstructionRisk(int weatherCode, double precipitationMm, double windKph)
    {
        bool isStorm        = weatherCode is 95 or 96 or 99;
        bool isHeavyRain     = weatherCode is 65 or 67 or 75 or 82 or 86;
        bool isModerateRain  = weatherCode is 61 or 63 or 66 or 73 or 80 or 81 or 85 or 55 or 57;
        bool isLightRain     = weatherCode is 51 or 53 or 56 or 71 or 77;

        if (isStorm || windKph >= 60 || precipitationMm >= 15)
            return ("extreme", "Severe weather — halt outdoor work & deliveries",
                "Thunderstorms or high winds detected. Postpone concrete pours, crane operations, and material deliveries.");
        if (isHeavyRain || windKph >= 40 || precipitationMm >= 7.5)
            return ("high", "High delay risk for deliveries & pours",
                "Heavy rain or strong winds may delay truck deliveries and make fresh concrete work unsafe.");
        if (isModerateRain || isLightRain || windKph >= 25)
            return ("moderate", "Moderate weather risk", "Light-to-moderate rain or wind expected.");
        return ("low", "No significant weather delays expected", "Conditions are favorable for deliveries and outdoor work.");
    }

    private class OpenMeteoResponse { [JsonPropertyName("current")] public OpenMeteoCurrent? Current { get; set; } }
    private class OpenMeteoCurrent
    {
        [JsonPropertyName("precipitation")]   public double Precipitation { get; set; }
        [JsonPropertyName("weather_code")]    public int    WeatherCode   { get; set; }
        [JsonPropertyName("wind_speed_10m")]  public double WindSpeed10m  { get; set; }
    }
}
