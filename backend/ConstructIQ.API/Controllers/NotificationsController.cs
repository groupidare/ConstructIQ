using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Notification;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController(INotificationService notificationService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    private string CurrentRole =>
        User.FindFirst("role")?.Value ?? string.Empty;

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] NotificationCreateDto dto) =>
        Ok(await notificationService.CreateAsync(dto, CurrentUserId));

    [HttpGet("mine")]
    public async Task<IActionResult> GetMine() =>
        Ok(await notificationService.GetForRoleAsync(CurrentRole));

    [HttpPut("{id:int}/read")]
    public async Task<IActionResult> MarkRead(int id)
    {
        var ok = await notificationService.MarkReadAsync(id);
        return ok ? NoContent() : NotFound();
    }
}
