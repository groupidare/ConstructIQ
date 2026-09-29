using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// Grown from the original "just enough for the BOQ procurement/warehouse
// alert buttons" scope into the app's general RBAC notification engine —
// still one table, one kind enum (grouped into WEATHER/REDISTRIBUTION/
// PROCUREMENT/SYSTEM buckets by the frontend for display, not a second
// parallel column here).
public enum NotificationKind
{
    ProcurementOrder, WarehouseCheck,
    Weather, WeatherApiDown,
    RedistributionRequested, RedistributionApproved, RedistributionRejected,
    ProcurementRequestSubmitted, PurchaseOrderCreated, PurchaseOrderStatusChanged, PurchaseOrderDelayed,
    MaterialDelivered, PodRatingSubmitted,
    UserRegistered, UserRoleChanged,
}

public class Notification
{
    public int Id { get; set; }

    public UserRole RecipientRole { get; set; }

    // Null for Admin/system notifications that aren't tied to any one project.
    public int? ProjectId { get; set; }
    public Project? Project { get; set; }

    public int? MaterialId { get; set; }
    public Material? Material { get; set; }

    public NotificationKind Kind { get; set; }

    [Required, MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [Required]
    public string Message { get; set; } = string.Empty;

    // Frontend route to navigate to when the notification card is clicked, e.g. "/redistribution?id=42".
    [MaxLength(300)]
    public string? ActionLink { get; set; }

    [Column(TypeName = "decimal(12,3)")]
    public decimal? Quantity { get; set; }

    public int CreatedByUserId { get; set; }
    public User CreatedBy { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<NotificationRead> Reads { get; set; } = [];
}

// Per-viewer read receipt — a role can be held by many users (Admin,
// WarehousePersonnel, ProcurementOfficer), so "read" can't live as one
// shared flag on the notification row without one person's click hiding
// it for everyone else who holds that role.
public class NotificationRead
{
    public int NotificationId { get; set; }
    public Notification Notification { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public DateTime ReadAt { get; set; } = DateTime.UtcNow;
}
