using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum NotificationKind { ProcurementOrder, WarehouseCheck }

// Intentionally minimal — just enough to make the Bill of Quantities'
// procurement/warehouse alert buttons real. Not a general-purpose alerts platform.
public class Notification
{
    public int Id { get; set; }

    public UserRole RecipientRole { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int? MaterialId { get; set; }
    public Material? Material { get; set; }

    public NotificationKind Kind { get; set; }

    [Required]
    public string Message { get; set; } = string.Empty;

    [Column(TypeName = "decimal(12,3)")]
    public decimal? Quantity { get; set; }

    public bool IsRead { get; set; } = false;

    public int CreatedByUserId { get; set; }
    public User CreatedBy { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
