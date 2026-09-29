using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Notification;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class NotificationService(AppDbContext db) : INotificationService
{
    private static readonly Dictionary<NotificationKind, string> DefaultTitles = new()
    {
        [NotificationKind.ProcurementOrder]            = "Procurement Alert",
        [NotificationKind.WarehouseCheck]               = "Warehouse Alert",
        [NotificationKind.Weather]                      = "Weather Alert",
        [NotificationKind.WeatherApiDown]               = "Weather Service Unavailable",
        [NotificationKind.RedistributionRequested]      = "Redistribution Requested",
        [NotificationKind.RedistributionApproved]       = "Redistribution Approved",
        [NotificationKind.RedistributionRejected]       = "Redistribution Rejected",
        [NotificationKind.ProcurementRequestSubmitted]  = "New Procurement Request",
        [NotificationKind.PurchaseOrderCreated]         = "Purchase Order Created",
        [NotificationKind.PurchaseOrderStatusChanged]   = "Purchase Order Updated",
        [NotificationKind.PurchaseOrderDelayed]         = "Purchase Order Delayed",
        [NotificationKind.MaterialDelivered]            = "Material Delivered",
        [NotificationKind.PodRatingSubmitted]           = "Delivery Rated",
        [NotificationKind.UserRegistered]               = "New User Registered",
        [NotificationKind.UserRoleChanged]              = "User Role Changed",
    };

    public async Task<NotificationResponseDto> CreateAsync(NotificationCreateDto dto, int userId)
    {
        var kind = Enum.Parse<NotificationKind>(dto.Kind, ignoreCase: true);
        var notification = new Notification
        {
            RecipientRole   = Enum.Parse<UserRole>(dto.RecipientRole, ignoreCase: true),
            ProjectId       = dto.ProjectId,
            MaterialId      = dto.MaterialId,
            Kind            = kind,
            Title           = dto.Title ?? DefaultTitles.GetValueOrDefault(kind, "Notification"),
            Message         = dto.Message,
            ActionLink      = dto.ActionLink,
            Quantity        = dto.Quantity,
            CreatedByUserId = userId,
        };

        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        var saved = await db.Notifications
            .Include(n => n.Project)
            .Include(n => n.Material)
            .FirstAsync(n => n.Id == notification.Id);
        return ToDto(saved, isRead: false);
    }

    public async Task CreateForRoleAsync(UserRole recipientRole, NotificationKind kind, string message, int createdByUserId,
        int? projectId = null, int? materialId = null, decimal? quantity = null, string? title = null, string? actionLink = null)
    {
        db.Notifications.Add(new Notification
        {
            RecipientRole   = recipientRole,
            ProjectId       = projectId,
            MaterialId      = materialId,
            Kind            = kind,
            Title           = title ?? DefaultTitles.GetValueOrDefault(kind, "Notification"),
            Message         = message,
            ActionLink      = actionLink,
            Quantity        = quantity,
            CreatedByUserId = createdByUserId,
        });
        await db.SaveChangesAsync();
    }

    public async Task<IEnumerable<NotificationResponseDto>> GetMineAsync(int userId, string role)
    {
        var parsedRole = Enum.Parse<UserRole>(role, ignoreCase: true);

        var query = db.Notifications
            .Include(n => n.Project)
            .Include(n => n.Material)
            .Where(n => n.RecipientRole == parsedRole);

        // PM/SiteEngineer notifications are always project-linked and scoped to
        // whichever project this specific person manages/is assigned to — the
        // "scoped entity ownership" guardrail. Admin/WarehousePersonnel/
        // ProcurementOfficer are broadcast role buckets with no per-person owner,
        // so every holder of the role sees every notification for it.
        query = parsedRole switch
        {
            UserRole.ProjectManager => query.Where(n => n.Project != null && n.Project.ProjectManagerId == userId),
            UserRole.SiteEngineer   => query.Where(n => n.Project != null && n.Project.SiteEngineerId == userId),
            _ => query,
        };

        var rows = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(50)
            .Select(n => new
            {
                Notification = n,
                IsRead = n.Reads.Any(r => r.UserId == userId),
            })
            .ToListAsync();

        return rows.Select(r => ToDto(r.Notification, r.IsRead));
    }

    public async Task<bool> MarkReadAsync(int id, int userId)
    {
        var exists = await db.Notifications.AnyAsync(n => n.Id == id);
        if (!exists) return false;

        var alreadyRead = await db.NotificationReads.AnyAsync(r => r.NotificationId == id && r.UserId == userId);
        if (!alreadyRead)
        {
            db.NotificationReads.Add(new NotificationRead { NotificationId = id, UserId = userId });
            await db.SaveChangesAsync();
        }
        return true;
    }

    private static NotificationResponseDto ToDto(Notification n, bool isRead) => new()
    {
        Id            = n.Id,
        RecipientRole = n.RecipientRole.ToString(),
        ProjectId     = n.ProjectId,
        ProjectName   = n.Project?.Name,
        MaterialId    = n.MaterialId,
        MaterialName  = n.Material?.Name,
        Kind          = n.Kind.ToString(),
        Title         = n.Title,
        Message       = n.Message,
        ActionLink    = n.ActionLink,
        Quantity      = n.Quantity,
        IsRead        = isRead,
        CreatedAt     = n.CreatedAt,
    };
}
