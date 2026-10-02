namespace ConstructIQ.API.Services;

// ml-service runs as a Render Private Service with no public URL, so an
// external uptime monitor (BetterStack etc.) can't reach it directly to keep
// it from idling out on the free tier — only something already inside
// Render's network can. This pings its /health endpoint periodically so it
// never goes idle long enough to reset its filesystem (which would otherwise
// lose any retrained model files), as long as this backend process itself
// stays awake — which the external monitor handles for this process.
public class MlServiceKeepAliveService(IHttpClientFactory httpFactory, ILogger<MlServiceKeepAliveService> logger) : BackgroundService
{
    // Comfortably under Render's ~15-minute idle-shutdown threshold.
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        // PeriodicTimer only fires *after* the first interval elapses, which
        // would leave ml-service un-pinged (and so still cold, or going cold)
        // for the first 10 minutes after every backend deploy/restart — ping
        // once immediately here so that gap doesn't exist.
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
            var client = httpFactory.CreateClient("MLService");
            await client.GetAsync("/health", stoppingToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort — a failed ping here should never crash the
            // backend; it just means ml-service stays cold a bit longer.
            logger.LogWarning(ex, "ml-service keep-alive ping failed.");
        }
    }
}
