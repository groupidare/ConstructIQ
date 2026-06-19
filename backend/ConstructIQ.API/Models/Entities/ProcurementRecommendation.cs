using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum UrgencyLevel           { Low, Medium, High, Critical }
public enum PurchaseRequestStatus  { Draft, Pending, Approved, Rejected, Ordered }

public class ProcurementRecommendation
{
    public int Id { get; set; }

    public int ProjectId  { get; set; }
    public Project Project { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal CurrentStock         { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal ReorderPoint         { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal TargetStockLevel     { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal ForecastedDemand     { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal RecommendedQuantity  { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal EstimatedCost        { get; set; }

    public DateTime SuggestedReorderDate  { get; set; }
    public int      EstimatedLeadTimeDays { get; set; }

    public UrgencyLevel UrgencyLevel { get; set; }
    public string? Notes { get; set; }
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;

    public ICollection<PurchaseRequest> PurchaseRequests { get; set; } = [];
}

public class PurchaseRequest
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int? RecommendationId { get; set; }
    public ProcurementRecommendation? Recommendation { get; set; }

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal RequestedQuantity  { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal EstimatedUnitCost  { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal TotalEstimatedCost { get; set; }

    public PurchaseRequestStatus Status { get; set; } = PurchaseRequestStatus.Draft;

    public int RequestedByUserId { get; set; }
    public User RequestedBy { get; set; } = null!;
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;

    public int? ApprovedByUserId { get; set; }
    public User? ApprovedBy { get; set; }
    public DateTime? ApprovedAt { get; set; }

    public string? Notes { get; set; }
}
