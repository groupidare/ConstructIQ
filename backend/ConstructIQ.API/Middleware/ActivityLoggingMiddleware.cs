using System.Security.Claims;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;

namespace ConstructIQ.API.Middleware;

public class ActivityLoggingMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, AppDbContext db)
    {
        await next(context);

        if (context.User.Identity?.IsAuthenticated == true &&
            context.Request.Method is "POST" or "PUT" or "PATCH" or "DELETE")
        {
            var userIdClaim = context.User.FindFirst(ClaimTypes.NameIdentifier)
                           ?? context.User.FindFirst("sub");
            if (int.TryParse(userIdClaim?.Value, out var userId))
            {
                db.ActivityLogs.Add(new ActivityLog
                {
                    UserId    = userId,
                    Action    = $"{context.Request.Method} {context.Request.Path}",
                    IpAddress = context.Connection.RemoteIpAddress?.ToString(),
                    Details   = $"Status: {context.Response.StatusCode}",
                });
                await db.SaveChangesAsync();
            }
        }
    }
}
