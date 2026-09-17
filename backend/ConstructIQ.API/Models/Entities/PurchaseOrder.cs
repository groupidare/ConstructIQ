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
}
