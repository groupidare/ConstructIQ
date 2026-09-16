using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum RedistributionPriority { Low, Medium, High }

// Mirrors Table 28 (redistribution_requests) in the capstone data dictionary.
public enum RedistributionStatus { AiSuggested, PendingApproval, Approved, InTransit, Completed, Rejected }

public class RedistributionRequest
{
    public int Id { get; set; }

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public int SourceProjectId { get; set; }
    public Project SourceProject { get; set; } = null!;

    public int TargetProjectId { get; set; }
    public Project TargetProject { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal Quantity         { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal UnitCost         { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal EstimatedSavings { get; set; }

    // Kept alongside Quantity (the actual transfer amount) so a re-read of a saved
    // request can still show how well supply matched demand — not just the outcome.
    [Column(TypeName = "decimal(18,4)")] public decimal AvailableExcessAtSource { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal NeededQuantityAtTarget { get; set; }

    public RedistributionPriority Priority { get; set; } = RedistributionPriority.Medium;
    public RedistributionStatus   Status   { get; set; } = RedistributionStatus.AiSuggested;

    public bool IsAiRecommended { get; set; } = true;
    public string? Notes { get; set; }

    public int?  RequestedByUserId { get; set; }
    public User? RequestedBy       { get; set; }

    public int?  ApprovedByUserId { get; set; }
    public User? ApprovedBy       { get; set; }

    public DateTime  RequestedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ApprovedAt  { get; set; }
    public DateTime? CompletedAt { get; set; }
}
