using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum MaterialRequestStatus { Pending, Approved }

// A site engineer's request to the warehouse to release/check materials for
// their project — distinct from RedistributionRequest (project-to-project
// excess transfer) and PurchaseRequest (buying new stock from a supplier).
public class MaterialRequest
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal RequestedQuantity { get; set; }

    public MaterialRequestStatus Status { get; set; } = MaterialRequestStatus.Pending;

    public int RequestedByUserId { get; set; }
    public User RequestedBy { get; set; } = null!;
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;

    public int?  ApprovedByUserId { get; set; }
    public User? ApprovedBy       { get; set; }
    public DateTime? ApprovedAt   { get; set; }
}
