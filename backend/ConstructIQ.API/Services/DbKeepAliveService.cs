using ConstructIQ.API.Data;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Aiven's free MySQL plan auto-powers-off the whole database after a period
// of no real client activity — a TCP ping or an HTTP uptime check (BetterStack
// etc.) never reaches it, since MySQL isn't an HTTP service, and even a bare
// TCP handshake wouldn't count as "activity" to Aiven's own idle detector.
// Only an actual connection + query from a real client keeps it counted as in
// use, so this runs a trivial query on a timer — same keep-alive shape as
// MlServiceKeepAliveService, just aimed at the database instead of ml-service.
public class DbKeepAliveService(IServiceScopeFactory scopeFactory, ILogger<DbKeepAliveService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        // Ping once immediately so a cold start right after a deploy doesn't
        // sit un-queried for the first full interval — same reasoning as
        // MlServiceKeepAliveService's own immediate first ping.
        await PingAsync(stoppingToken);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await PingAsync(stoppingToken);
        }
    }

    private async Task PingAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("SELECT 1", stoppingToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort — a failed ping here should never crash the
            // backend; it just means the database stays at risk of idling
            // out a bit longer until the next tick retries.
            logger.LogWarning(ex, "Database keep-alive ping failed.");
        }
    }
}
