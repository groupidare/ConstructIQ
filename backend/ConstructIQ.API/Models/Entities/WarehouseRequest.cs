using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum WarehouseRequestStatus { Pending, Approved, Rejected }

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

    // The BOQ row this is for. Null for requests made before rows were tracked,
    // or if the row has since been deleted — see ProcurementCapCalculator.
    public int? BOQItemId { get; set; }
    public BOQItem? BOQItem { get; set; }

    [Column(TypeName = "decimal(18,4)")] public decimal RequestedQuantity { get; set; }

    // The unit it was asked in. Material.Unit won't do: a catalog material's
    // unit can be a BOQ measure (sq.m) when the request is for pieces.
    [MaxLength(20)] public string Unit { get; set; } = string.Empty;

    // Beyond what the row still needed when asked (breakage, a design change).
    public bool IsAdditional { get; set; }

    public WarehouseRequestStatus Status { get; set; } = WarehouseRequestStatus.Pending;

    // The quantity actually released from warehouse stock — set at approval
    // time, and can be LESS than RequestedQuantity when the warehouse simply
    // doesn't have the full amount on hand (e.g. 12 requested, only 3
    // available). This, not RequestedQuantity, is what reduces how much a
    // project still needs from Procurement — see ProcurementCapCalculator.
    [Column(TypeName = "decimal(18,4)")] public decimal? ApprovedQuantity { get; set; }

    public int RequestedByUserId { get; set; }
    public User RequestedBy { get; set; } = null!;
    public DateTime RequestedAt { get; set; } = DateTime.UtcNow;

    public int?  ApprovedByUserId { get; set; }
    public User? ApprovedBy       { get; set; }
    public DateTime? ApprovedAt   { get; set; }

    // Whose logged Excess this release used up, if any.
    public List<WarehouseReleaseSource> ReleaseSources { get; set; } = [];

    // An approved release also goes into the warehouse Google Sheet's STOCK OUT
    // (ExcessSheetSyncService). Pending until written; a failed write stays
    // pending and is retried. SheetSyncError carries the last failure, or why
    // it wasn't written.
    public bool SheetSyncPending { get; set; }
    public DateTime? SheetSyncedAt { get; set; }
    [MaxLength(300)] public string? SheetSyncError { get; set; }
}
