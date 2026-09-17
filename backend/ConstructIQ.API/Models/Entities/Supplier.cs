using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

// Rating/on-time/delivery counts are never stored here — they're always
// computed live from DeliveryEvaluation history, so the numbers can never
// drift out of sync with what was actually logged.
public class Supplier
{
    public int Id { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(100)]
    public string Category { get; set; } = "General";

    // Human-readable lead-time estimate, e.g. "3-5 days".
    [MaxLength(50)]
    public string Lead { get; set; } = "—";

    [MaxLength(255)]
    public string? ContactEmail { get; set; }

    [MaxLength(50)]
    public string? ContactPhone { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<PurchaseOrder> PurchaseOrders { get; set; } = [];
}
