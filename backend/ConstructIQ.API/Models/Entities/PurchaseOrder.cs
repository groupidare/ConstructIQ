using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// DELAYED is deliberately not a stored value here — it's derived on read
// (Status != Delivered && ExpectedDate has passed) so it can never be set
// by hand and can never drift out of sync with the actual clock.
public enum PurchaseOrderStatus { Pending, Approved, Delivered }

public class PurchaseOrder
{
    public int Id { get; set; }

    [Required, MaxLength(30)]
    public string Number { get; set; } = string.Empty;

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int SupplierId { get; set; }
    public Supplier Supplier { get; set; } = null!;

    public PurchaseOrderStatus Status { get; set; } = PurchaseOrderStatus.Pending;

    // When the order was actually placed — distinct from CreatedAt (when the
    // record was entered into the system), so a historical/scanned PO can
    // carry its true date instead of "today". Defaults to CreatedAt's date
    // for live orders entered as they happen.
    public DateTime OrderDate { get; set; } = DateTime.UtcNow;

    public DateTime ExpectedDate { get; set; }

    public int CreatedByUserId { get; set; }
    public User CreatedBy { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<PurchaseOrderMaterial> Materials { get; set; } = [];
    public DeliveryEvaluation? Evaluation { get; set; }
}

public class PurchaseOrderMaterial
{
    public int Id { get; set; }

    public int PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [Column(TypeName = "decimal(18,4)")]
    public decimal Quantity { get; set; }

    [MaxLength(20)]
    public string Unit { get; set; } = "pcs";

    // Links this PO line to the real Material/BOQ data it corresponds to, so it
    // can feed BOQItem.ActualQuantity syncing and ML training. Nullable because
    // a scanned/typed name may not match anything yet — MaterialId is set via
    // best-effort name-matching on save (never auto-created, unlike BOQ scanning),
    // BOQItemId only via an explicit user link (never auto-guessed, to avoid
    // silently corrupting training data with a wrong match). PhaseId/PrimarySection/
    // SubCategory are a fallback pairing key for rows without an explicit link.
    public int? MaterialId { get; set; }
    public Material? Material { get; set; }

    public int? BOQItemId { get; set; }
    public BOQItem? BOQItem { get; set; }

    public int? PhaseId { get; set; }
    public Phase? Phase { get; set; }

    [MaxLength(100)] public string? PrimarySection { get; set; }
    [MaxLength(100)] public string? SubCategory    { get; set; }
}
