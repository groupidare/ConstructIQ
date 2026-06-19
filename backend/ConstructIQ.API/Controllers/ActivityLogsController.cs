using ConstructIQ.API.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/activity-logs")]
[Authorize(Roles = "Admin")]
public class ActivityLogsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
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
}
