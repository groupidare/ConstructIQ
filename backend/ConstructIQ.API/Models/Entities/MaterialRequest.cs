using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// A project's ask for more of a specific material — raised from the BOQ/Material
// Plan tab's "Notify Procurement" button. Lives independently of Notification
// (which is just a fire-and-forget alert): this is the trackable object a
// Procurement Officer fulfills by generating a real PurchaseOrder against it.
public class MaterialRequest
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")]
    public decimal Quantity { get; set; }

    [MaxLength(20)]
    public string Unit { get; set; } = string.Empty;

    public int RequestedByUserId { get; set; }
    public User RequestedBy { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Null = still pending. Set the moment a Procurement Officer generates a
    // PO covering this request — that PO is the single source of truth for
    // what happened next, so there's no separate status enum to drift out of
    // sync with it.
    public int? FulfilledByPurchaseOrderId { get; set; }
    public PurchaseOrder? FulfilledByPurchaseOrder { get; set; }
}
