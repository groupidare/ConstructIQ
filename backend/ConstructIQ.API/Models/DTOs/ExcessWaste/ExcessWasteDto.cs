using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.ExcessWaste;

public class ExcessWasteCreateDto
{
    [Required] public int     ProjectId   { get; set; }
    public int?    PhaseId         { get; set; }
    public int?    MaterialId      { get; set; }
    public string? NewMaterialName { get; set; }
    public string? Unit            { get; set; }
    // The specific BOQ line this is logged against — when present, drives
    // BOQItem.ActualQuantity (Est. Qty minus everything logged against it)
    // and is what makes a material stop appearing in the "still needs
    // logging" picker. Optional so the older free-text flow keeps working.
    public int?    BOQItemId  { get; set; }
    [Required] public string  ExcessType  { get; set; } = string.Empty;
    [Range(0.0001, double.MaxValue)] public decimal Quantity { get; set; }
    [Range(0, double.MaxValue)]      public decimal UnitCost { get; set; }
    public bool    IsReusable { get; set; }
    public string? Notes      { get; set; }
}

public class ExcessWasteUpdateDto
{
    public string? NewMaterialName { get; set; }
    public string? Unit            { get; set; }
    [Required] public string ExcessType { get; set; } = string.Empty;
    [Range(0.0001, double.MaxValue)] public decimal Quantity { get; set; }
    public bool IsReusable { get; set; }
}

public class ExcessWasteResponseDto
{
    public int      Id           { get; set; }
    public int      ProjectId    { get; set; }
    public string   ProjectName  { get; set; } = string.Empty;
    public int?     PhaseId      { get; set; }
    public string   PhaseName    { get; set; } = string.Empty;
    public int?     BOQItemId    { get; set; }
    public int      MaterialId   { get; set; }
    public string   MaterialName { get; set; } = string.Empty;
    public string   Unit         { get; set; } = string.Empty;
    public string   ExcessType   { get; set; } = string.Empty;
    public decimal  Quantity     { get; set; }
    public decimal  UnitCost     { get; set; }
    public decimal  TotalCost    { get; set; }
    public decimal  ExcessPercent{ get; set; }
    public bool     IsReusable   { get; set; }
    public string?  Notes        { get; set; }
    public string   RecordedBy   { get; set; } = string.Empty;
    public DateTime RecordedAt   { get; set; }

    // Set only when this excess entry has a real, non-rejected redistribution
    // request against it — lets the log show where the material actually went.
    public string? RedistributionStatus            { get; set; }
    public string? RedistributionTargetProjectName { get; set; }
}

public class ExcessAnalyticsSummaryDto
{
    public int     ProjectId           { get; set; }
    public string  ProjectName         { get; set; } = string.Empty;
    public decimal TotalExcessCost     { get; set; }
    public decimal TotalExcessQuantity { get; set; }
    public decimal ReusableValue       { get; set; }
    public List<ExcessByMaterialDto>   ExcessByMaterial { get; set; } = [];
    public List<MonthlyExcessTrendDto> MonthlyTrend     { get; set; } = [];
}

public class ExcessByMaterialDto
{
    public int     MaterialId     { get; set; }
    public string  MaterialName   { get; set; } = string.Empty;
    public decimal TotalQuantity  { get; set; }
    public decimal TotalCost      { get; set; }
    public decimal ExcessPercent  { get; set; }
}

public class MonthlyExcessTrendDto
{
    public string  Month         { get; set; } = string.Empty;
    public decimal TotalCost     { get; set; }
    public decimal TotalQuantity { get; set; }
}

// A BOQ line from the project's real Material Plan that has no
// ExcessWasteRecord linked to it yet — what the Record Material Excess
// modal's material picker is actually built from, so a material logged
// once (in any earlier session) drops out of the list for next time.
public class PendingBOQItemDto
{
    public int     BOQItemId          { get; set; }
    public int      MaterialId        { get; set; }
    public string   MaterialName      { get; set; } = string.Empty;
    public string   Unit              { get; set; } = string.Empty;
    // The "initial/Est. Qty" baseline the modal subtracts the logged excess
    // from to preview Actual Usage — prefers the purchase-unit estimate
    // (Est. Qty column) and falls back to the raw BOQ EstimatedQuantity.
    public decimal  EstimatedQuantity { get; set; }
}
