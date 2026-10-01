using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.BOQ;

public class BOQItemUpsertDto
{
    public int?    Id                { get; set; } // null = create new
    public int?    PhaseId           { get; set; }
    [Required] public string PrimarySection { get; set; } = string.Empty;
    public string? SubCategory       { get; set; }
    // Either MaterialId (existing catalog entry) or NewMaterialName (+ Unit) —
    // exactly one path is required; see BOQService.
    public int?    MaterialId        { get; set; }
    public string? NewMaterialName   { get; set; }
    public string? Unit              { get; set; }
    // The row's own scanned/typed description — kept distinct from the
    // catalog Material's name so a fuzzy-matched row still shows what the
    // source document actually said. See BOQItem.Specification.
    public string? Specification     { get; set; }
    public decimal EstimatedQuantity { get; set; }
    // Only meaningful for historical/completed projects backfilling training
    // data — live projects derive actual usage from inventory movements instead.
    public decimal? ActualQuantity   { get; set; }
    public string? Notes             { get; set; }
    // Real purchase lines extracted from a historical project's combined
    // BOQ+PO report — full-replace on every save, see BOQService.BulkSaveAsync.
    public List<HistoricalSupplyLineDto>? HistoricalSupply { get; set; }
    // Predicted procurement quantity/unit for new projects — auto-suggested
    // from historical data, user-editable. See BOQItem.EstimatedPurchaseQuantity.
    public decimal? EstimatedPurchaseQuantity { get; set; }
    public string?  EstimatedPurchaseUnit     { get; set; }
    // How much of EstimatedPurchaseQuantity has been requested so far — see
    // BOQItem.RequestedQuantity.
    public decimal? RequestedQuantity { get; set; }
}

public class HistoricalSupplyLineDto
{
    public string? PoNumber     { get; set; }
    public string  MaterialName { get; set; } = string.Empty;
    public string  Unit         { get; set; } = string.Empty;
    public decimal Quantity     { get; set; }
    public string? SupplierName { get; set; }
}

public class BOQBulkSaveDto
{
    [Required] public int ProjectId { get; set; }
    public List<BOQItemUpsertDto> Items { get; set; } = [];
}

public class BOQItemResponseDto
{
    public int      Id                { get; set; }
    public int      ProjectId         { get; set; }
    public int?     PhaseId           { get; set; }
    public string?  PhaseName         { get; set; }
    public string   PrimarySection    { get; set; } = string.Empty;
    public string?  SubCategory       { get; set; }
    public int      MaterialId        { get; set; }
    public string   MaterialName      { get; set; } = string.Empty;
    public string   Unit              { get; set; } = string.Empty;
    // The row's own scanned/typed description, distinct from MaterialName
    // (the catalog entry's canonical name) — see BOQItem.Specification.
    public string?  Specification     { get; set; }
    public decimal  EstimatedQuantity { get; set; }
    // Server-derived only (mirrors EstimatedQuantity when Unit is an area unit) —
    // never accepted from the client on save, see BOQItemUpsertDto.
    public decimal? CoverageArea     { get; set; }
    public decimal  ActualQuantity    { get; set; }
    public string?  Notes             { get; set; }
    public DateTime CreatedAt         { get; set; }
    public List<HistoricalSupplyResponseDto> HistoricalSupply { get; set; } = [];
    public decimal? EstimatedPurchaseQuantity { get; set; }
    public string?  EstimatedPurchaseUnit     { get; set; }
    public decimal? RequestedQuantity { get; set; }
    // Server-computed "Net Left to Order" — EstimatedPurchaseQuantity (or
    // EstimatedQuantity if that's unset) minus whatever's actually been
    // APPROVED so far (redistribution transfer, warehouse release, or
    // purchase order past Pending). A still-Pending request never moves
    // this. See ProcurementCapCalculator.GetNetLeftToOrderForProjectAsync.
    public decimal  NetLeftToOrder    { get; set; }
    // True once at least one WarehouseRequest for this row's material has
    // been Approved — Procurement can't be requested before that.
    public bool     WarehouseApproved { get; set; }
    // The real cap the Notify Procurement/Warehouse endpoints will actually
    // enforce — unlike NetLeftToOrder above, this ALSO subtracts every
    // MaterialRequest ever submitted for this material (not just approved
    // sources), since a prior ask already eats into what can be asked for
    // again. Deliberately can be lower than NetLeftToOrder — e.g. a request
    // for the full amount was already sent and is still awaiting a Purchase
    // Order, so nothing more can be requested yet even though nothing's been
    // approved against it either. See
    // ProcurementCapCalculator.GetRemainingRequestableForProjectAsync.
    public decimal  RemainingRequestable { get; set; }
}

public class HistoricalEstimateResponseDto
{
    public decimal? EstimatedQuantity { get; set; }
    public string?  Unit              { get; set; }
    public int      MatchCount        { get; set; }
}

// One point on the Forecasting page's chart, for one selected material+unit.
// Actual Usage = Baseline - Excess - Waste, computed fresh from
// ExcessWasteRecords (not read from the live BOQItem.ActualQuantity field —
// see ActualUsageCalculator), where Baseline is EstimatedPurchaseQuantity ??
// EstimatedQuantity per BOQ item (whichever the record was actually logged
// against), attributed to the calendar month each record was actually
// recorded in. AI Predicted is the real ML model's own output
// (ForecastedMaterial.ForecastedQuantity), attributed to the month its
// forecast run happened. Either side is null when nothing that month has
// that particular figure — never a fabricated zero, and the frontend must
// render this as a gap, not interpolate across it.
public class MonthlyDemandSummaryDto
{
    public string   Month                { get; set; } = string.Empty; // e.g. "2026-01"
    public string   MonthLabel           { get; set; } = string.Empty; // e.g. "September 2026"
    public int      MaterialId           { get; set; }
    public string   MaterialName         { get; set; } = string.Empty;
    public string   Unit                 { get; set; } = string.Empty;
    public decimal? ActualUsage          { get; set; }
    public decimal? AiPredicted          { get; set; }
    // "Provisional" while the contributing project(s) are still active (more
    // excess/waste could still be logged, changing this number); "Finalized"
    // once every contributing project is Completed or IsHistorical. Null when
    // ActualUsage itself is null (nothing to qualify).
    public string?  ReconciliationStatus { get; set; }
    public List<string> ContributingProjects { get; set; } = [];
    public decimal? EstimatedTotal       { get; set; }
    public decimal? ExcessTotal          { get; set; }
    public decimal? WasteTotal           { get; set; }
}

// One entry in the Forecasting page's material selector — every unique
// material+unit pair that has ever contributed a real, validated Actual
// Usage figure, ranked by total historical demand (highest first).
public class MaterialOptionDto
{
    public int     MaterialId            { get; set; }
    public string  MaterialName          { get; set; } = string.Empty;
    public string  Unit                  { get; set; } = string.Empty;
    public decimal TotalHistoricalDemand { get; set; }
}

// A BOQItem where logged Excess+Waste exceeds its EstimatedQuantity — data
// that can't be trusted for the Actual Usage calculation. Surfaced for
// review rather than silently clamped or hidden without explanation.
public class FlaggedExcessItemDto
{
    public int     BOQItemId    { get; set; }
    public int     ProjectId    { get; set; }
    public string  ProjectName  { get; set; } = string.Empty;
    public string  MaterialName { get; set; } = string.Empty;
    public string  Unit         { get; set; } = string.Empty;
    public decimal EstimatedQuantity { get; set; }
    public decimal ExcessTotal  { get; set; }
    public decimal WasteTotal   { get; set; }
    public string  Reason       { get; set; } = string.Empty;
}

public class HistoricalSupplyResponseDto
{
    public int      Id           { get; set; }
    public int?     SupplierId   { get; set; }
    public string?  SupplierName { get; set; }
    public string?  PoNumber     { get; set; }
    public string   MaterialName { get; set; } = string.Empty;
    public string   Unit         { get; set; } = string.Empty;
    public decimal  Quantity     { get; set; }
}
