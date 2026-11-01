using System.Security.Claims;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;

namespace ConstructIQ.API.Middleware;

public class ActivityLoggingMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IServiceScopeFactory scopeFactory, ILogger<ActivityLoggingMiddleware> logger)
    {
        await next(context);

        if (!context.Items.ContainsKey("SkipActivityAudit") && context.User.Identity?.IsAuthenticated == true &&
            context.Request.Method is "POST" or "PUT" or "PATCH" or "DELETE")
        {
            var userIdClaim = context.User.FindFirst(ClaimTypes.NameIdentifier)
                           ?? context.User.FindFirst("sub");
            if (int.TryParse(userIdClaim?.Value, out var userId))
            {
                // Independent context: audit persistence must never flush failed business changes.
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.ActivityLogs.Add(new ActivityLog
                {
                    UserId    = userId,
                    Action    = $"{context.Request.Method} {context.Request.Path}",
                    IpAddress = context.Connection.RemoteIpAddress?.ToString(),
                    Details   = $"Status: {context.Response.StatusCode}",
                });
                try { await db.SaveChangesAsync(); }
                catch (Exception ex) { logger.LogError(ex, "Activity audit persistence failed for {Method} {Path}", context.Request.Method, context.Request.Path); }
            }
        }
    }
}
