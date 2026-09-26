using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Procurement;

public class ProcurementRecommendationDto
{
    public int      Id                    { get; set; }
    public int      ProjectId             { get; set; }
    public int      MaterialId            { get; set; }
    public string   MaterialName          { get; set; } = string.Empty;
    public string   Unit                  { get; set; } = string.Empty;
    public decimal  CurrentStock          { get; set; }
    public decimal  ReorderPoint          { get; set; }
    public decimal  TargetStockLevel      { get; set; }
    public decimal  ForecastedDemand      { get; set; }
    public decimal  RecommendedQuantity   { get; set; }
    public decimal  EstimatedCost         { get; set; }
    public DateTime SuggestedReorderDate  { get; set; }
    public int      EstimatedLeadTimeDays { get; set; }
    public string   UrgencyLevel          { get; set; } = string.Empty;
    public string?  Notes                 { get; set; }
    public DateTime GeneratedAt           { get; set; }
}

public class PurchaseRequestCreateDto
{
    [Required] public int     ProjectId           { get; set; }
    public int?    RecommendationId   { get; set; }
    [Required] public int     MaterialId           { get; set; }
    [Range(0.0001, double.MaxValue)] public decimal RequestedQuantity { get; set; }
    [Range(0, double.MaxValue)]      public decimal EstimatedUnitCost { get; set; }
    public string? Notes { get; set; }
}

public class PurchaseRequestDto
{
    public int      Id                  { get; set; }
    public int      ProjectId           { get; set; }
    public string   ProjectName         { get; set; } = string.Empty;
    public int?     RecommendationId    { get; set; }
    public int      MaterialId          { get; set; }
    public string   MaterialName        { get; set; } = string.Empty;
    public string   Unit                { get; set; } = string.Empty;
    public decimal  RequestedQuantity   { get; set; }
    public decimal  EstimatedUnitCost   { get; set; }
    public decimal  TotalEstimatedCost  { get; set; }
    public string   Status              { get; set; } = string.Empty;
    public string   RequestedBy         { get; set; } = string.Empty;
    public DateTime RequestedAt         { get; set; }
    public string?  ApprovedBy          { get; set; }
    public DateTime? ApprovedAt         { get; set; }
    public string?  Notes               { get; set; }
}

public class RedistributionTargetSuggestionDto
{
    public int      ProjectId                 { get; set; }
    public string   ProjectName               { get; set; } = string.Empty;
    // True when the candidate project already uses this exact material
    // (appears in its BOQ or current inventory) — the sole real matching
    // signal; no shortage/forecast math involved.
    public bool     UsesThisMaterial          { get; set; }
    public bool     SameProjectType           { get; set; }
    public int      MatchScore                { get; set; }
    public string   MatchReason               { get; set; } = string.Empty;
}

// A material's total quantity received by a project via approved
// redistribution — subtracted from Estimated Qty when capping how much more
// can be requested via Notify Procurement/Warehouse.
public class ReceivedRedistributionDto
{
    public int     MaterialId    { get; set; }
    public decimal TotalQuantity { get; set; }
}

public class RedistributeFromExcessDto
{
    [Required] public int ExcessWasteRecordId { get; set; }
    [Required] public int TargetProjectId     { get; set; }

    // Defaults to the excess record's full logged quantity when omitted.
    [Range(0.0001, double.MaxValue)] public decimal? Quantity { get; set; }
    public string? Notes { get; set; }
}

public class RedistributionRecommendationDto
{
    public int      Id                  { get; set; }
    public int      SourceMaterialId    { get; set; }
    public string   MaterialName        { get; set; } = string.Empty;
    public string   Unit                { get; set; } = string.Empty;
    public int      SourceProjectId     { get; set; }
    public string   SourceProjectName   { get; set; } = string.Empty;
    public int      TargetProjectId     { get; set; }
    public string   TargetProjectName   { get; set; } = string.Empty;
    public decimal  AvailableQuantity   { get; set; }
    public decimal  NeededQuantity      { get; set; }
    public decimal  TransferQuantity    { get; set; }
    public decimal  UnitCost            { get; set; }
    public decimal  EstimatedSavings    { get; set; }
    public string   Priority            { get; set; } = string.Empty;
    public string   Status              { get; set; } = string.Empty;
    public bool     IsAiRecommended     { get; set; }
    public string?  Notes               { get; set; }
    public DateTime GeneratedAt         { get; set; }
}
