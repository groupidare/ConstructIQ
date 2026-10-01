using ConstructIQ.API.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/activity-logs")]
[Authorize(Policy = "AdminOnly")]
public class ActivityLogsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var skip = (page - 1) * pageSize;

        var logs = await db.ActivityLogs
            .Include(l => l.User)
            .OrderByDescending(l => l.CreatedAt)
            .Skip(skip)
            .Take(pageSize)
            .Select(l => new
            {
                l.Id,
                l.UserId,
                UserDisplay = l.User != null ? $"{l.User.FirstName} {l.User.LastName}" : "System",
                l.Action,
                l.EntityType,
                l.EntityId,
                l.IpAddress,
                l.Details,
                l.CreatedAt,
            })
            .ToListAsync();

        return Ok(logs);
    }

    [HttpGet("/api/v1/activity-logs")]
    public async Task<IActionResult> GetPage(int page = 1, int pageSize = 15, string? search = null, string? action = null)
    {
        page = Math.Clamp(page, 1, 1_000_000);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.ActivityLogs.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            search = search.Trim();
            query = query.Where(l => l.Action.Contains(search) || (l.Details != null && l.Details.Contains(search)) ||
                (l.User != null && (l.User.FirstName + " " + l.User.LastName).Contains(search)));
        }
        if (!string.IsNullOrWhiteSpace(action) && action != "All") query = query.Where(l => l.Action.Contains(action));
        var total = await query.CountAsync();
        var items = await query.OrderByDescending(l => l.CreatedAt).ThenByDescending(l => l.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).Select(l => new
            {
                l.Id, l.UserId, UserDisplay = l.User != null ? l.User.FirstName + " " + l.User.LastName : "System",
                l.Action, l.EntityType, l.EntityId, l.IpAddress, l.Details, l.CreatedAt,
            }).ToListAsync();
        Response.Headers.CacheControl = "no-store";
        return Ok(new { items, total, page, pageSize });
    }
}
