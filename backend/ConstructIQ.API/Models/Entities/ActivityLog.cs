using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

public class ActivityLog
{
    public int Id { get; set; }

    public int? UserId { get; set; }
    public User? User { get; set; }

    [Required, MaxLength(100)]
    public string Action { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? EntityType { get; set; }

    public int? EntityId { get; set; }

    public string? Details { get; set; }

    [MaxLength(45)]
    public string? IpAddress { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
