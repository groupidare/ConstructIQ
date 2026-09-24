using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum WarehouseRequestStatus { Pending, Approved }

// A site engineer's request to the warehouse to release/check materials for
// their project — distinct from MaterialRequest (the Procurement-facing "buy
// more of this" request fulfilled by a PurchaseOrder), RedistributionRequest
// (project-to-project excess transfer) and PurchaseRequest (buying new stock
// from a supplier via the Procurement Recommendations flow).
public class WarehouseRequest
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal RequestedQuantity { get; set; }

    public WarehouseRequestStatus Status { get; set; } = WarehouseRequestStatus.Pending;

    public int RequestedByUserId { get; set; }
    public User RequestedBy { get; set; } = null!;
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;

    public int?  ApprovedByUserId { get; set; }
    public User? ApprovedBy       { get; set; }
    public DateTime? ApprovedAt   { get; set; }
}
