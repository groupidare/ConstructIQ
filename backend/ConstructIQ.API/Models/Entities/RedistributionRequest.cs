using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum RedistributionPriority { Low, Medium, High }

// Mirrors Table 28 (redistribution_requests) in the capstone data dictionary.
// InTransit/Completed are part of that dictionary but not part of this app's
// actual workflow — Approved is the terminal state (approving a transfer
// immediately reflects in the target project's material need). Left in the
// enum rather than removed: it's a plain-int-backed column with no explicit
// ordinals, so deleting a middle member would shift Rejected's stored value
// and corrupt already-saved rows.
public enum RedistributionStatus { AiSuggested, PendingApproval, Approved, InTransit, Completed, Rejected }

public static class RedistributionStatuses
{
    // Requests still "in play" — not yet approved-and-settled or rejected.
    // InTransit/Completed are included for completeness with the enum above
    // but nothing in this app ever sets them. Used for display lists and the
    // AI batch-matcher's own dedupe (matches original pre-refactor behavior).
    public static readonly RedistributionStatus[] Active =
        [RedistributionStatus.AiSuggested, RedistributionStatus.PendingApproval, RedistributionStatus.Approved];

    // Genuinely undecided — awaiting approval/rejection. Deliberately excludes
    // Approved: that's a terminal, settled state, not "in flight," so a
    // partially-redistributed excess record (leftover Quantity > 0 after one
    // approval) can still be redistributed again or re-logged from — only a
    // concurrent, not-yet-decided request should block that.
    public static readonly RedistributionStatus[] Pending =
        [RedistributionStatus.AiSuggested, RedistributionStatus.PendingApproval];
}

public class RedistributionRequest
{
    public int Id { get; set; }

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public int SourceProjectId { get; set; }
    public Project SourceProject { get; set; } = null!;

    // The specific logged excess entry this transfer draws from, when one can be
    // identified — lets the Excess Recording Log show where a material went.
    public int?               SourceExcessWasteRecordId { get; set; }
    public ExcessWasteRecord? SourceExcessWasteRecord   { get; set; }

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
