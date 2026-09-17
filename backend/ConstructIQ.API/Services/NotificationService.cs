using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Notification;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class NotificationService(AppDbContext db) : INotificationService
{
    public async Task<NotificationResponseDto> CreateAsync(NotificationCreateDto dto, int userId)
    {
        var notification = new Notification
        {
            RecipientRole   = Enum.Parse<UserRole>(dto.RecipientRole, ignoreCase: true),
            ProjectId       = dto.ProjectId,
            MaterialId      = dto.MaterialId,
            Kind            = Enum.Parse<NotificationKind>(dto.Kind, ignoreCase: true),
            Message         = dto.Message,
            Quantity        = dto.Quantity,
            CreatedByUserId = userId,
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        var saved = await db.Notifications
            .Include(n => n.Project)
            .Include(n => n.Material)
            .FirstAsync(n => n.Id == notification.Id);
        return ToDto(saved);
    }

    public async Task<IEnumerable<NotificationResponseDto>> GetForRoleAsync(string role)
    {
        var parsedRole = Enum.Parse<UserRole>(role, ignoreCase: true);
        var rows = await db.Notifications
            .Include(n => n.Project)
            .Include(n => n.Material)
            .Where(n => n.RecipientRole == parsedRole)
            .OrderByDescending(n => n.CreatedAt)
            .Take(50)
            .ToListAsync();
        return rows.Select(ToDto);
    }

    public async Task<bool> MarkReadAsync(int id)
    {
        var n = await db.Notifications.FindAsync(id);
        if (n is null) return false;
        n.IsRead = true;
        await db.SaveChangesAsync();
        return true;
    }

    private static NotificationResponseDto ToDto(Notification n) => new()
    {
        Id            = n.Id,
        RecipientRole = n.RecipientRole.ToString(),
        ProjectId     = n.ProjectId,
        ProjectName   = n.Project.Name,
        MaterialId    = n.MaterialId,
        MaterialName  = n.Material?.Name,
        Kind          = n.Kind.ToString(),
        Message       = n.Message,
        Quantity      = n.Quantity,
        IsRead        = n.IsRead,
        CreatedAt     = n.CreatedAt,
    };
}
