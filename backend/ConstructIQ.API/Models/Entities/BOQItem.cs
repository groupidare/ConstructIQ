using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public class BOQItem
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    // Nullable: a BOQ row is grouped by PrimarySection/SubCategory first (the real
    // BOQ taxonomy), and only optionally also tied to a specific project Phase.
    public int? PhaseId { get; set; }
    public Phase? Phase { get; set; }

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [MaxLength(100)] public string? PrimarySection { get; set; }
    [MaxLength(100)] public string? SubCategory    { get; set; }

    // This row's own unit/description as actually written in the source BOQ
    // document — distinct from Material.Unit/Name, which are the catalog
    // entry's canonical values and can legitimately differ (e.g. a scanned
    // "kg" of adhesive fuzzy-matched to a catalog material priced by "bag").
    // Falling back to the catalog's own fields (as this used to do
    // exclusively) silently rewrote what the user's document actually said.
    [MaxLength(20)]  public string? Unit          { get; set; }
    [MaxLength(300)] public string? Specification { get; set; }

    [Column(TypeName = "decimal(18,4)")]
    public decimal EstimatedQuantity { get; set; }

    // Mirrors EstimatedQuantity only when Unit is an area unit (sq.m./sqm/m2/m²),
    // else null — derived server-side in BOQService, never client-supplied.
    [Column(TypeName = "decimal(18,4)")]
    public decimal? CoverageArea { get; set; }

    [Column(TypeName = "decimal(18,4)")]
    public decimal ActualQuantity { get; set; } = 0;

    // True only when ActualQuantity reflects a genuine signal — either a real
    // ExcessWasteRecord logged against this line (ExcessWasteService recomputes
    // this alongside ActualQuantity on every create/update/delete) or a real
    // number typed in during historical backfill (BOQService.BulkSaveAsync).
    // False means ActualQuantity is just the estimate standing in because
    // nothing was ever confirmed — e.g. ProjectService's completion fallback
    // for a line nobody ever logged Excess/Waste against. Lets ML training and
    // the Accuracy Report tell "observed" apart from "assumed" instead of
    // treating both as equally real ground truth.
    public bool IsUsageConfirmed { get; set; } = false;

    // Predicted procurement quantity for new (non-historical) projects — in a
    // real purchasable container unit (pc/bag/sheet/...), distinct from
    // EstimatedQuantity/Unit above which are often an area/length measure
    // (sq.m, l.m) that can't be ordered directly. Auto-suggested from
    // historical HistoricalMaterialSupply data (see BOQService) but always
    // user-editable afterward.
    [Column(TypeName = "decimal(18,4)")]
    public decimal? EstimatedPurchaseQuantity { get; set; }
    [MaxLength(20)] public string? EstimatedPurchaseUnit { get; set; }

    // How much of EstimatedPurchaseQuantity has actually been requested so far
    // (summed across every partial Notify Procurement/Warehouse click for this
    // row) — lets the UI show a "Done" badge once fully covered, and is what a
    // partial request shrinks this row down to (the leftover becomes a new
    // sibling BOQItem row with its own fresh RequestedQuantity of 0).
    [Column(TypeName = "decimal(18,4)")]
    public decimal? RequestedQuantity { get; set; }

    [Column(TypeName = "decimal(18,2)")]
    public decimal EstimatedUnitCost { get; set; }

    public string? Notes { get; set; }

    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<HistoricalMaterialSupply> HistoricalSupplies { get; set; } = [];
}
