using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.ExcessWaste;

public class ExcessWasteCreateDto
{
    [Required] public int     ProjectId   { get; set; }
    public int?    PhaseId         { get; set; }
    public int?    MaterialId      { get; set; }
    public string? NewMaterialName { get; set; }
    public string? Unit            { get; set; }
    // Every excess/waste entry must identify the specific BOQ line it belongs
    // to. This drives BOQItem.ActualQuantity and forecast-accuracy matching.
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
    // Quantity is what's still available to redistribute; LoggedQuantity is
    // what was recorded, which a redistribution doesn't change.
    public decimal  Quantity     { get; set; }
    public decimal  LoggedQuantity { get; set; }
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
    // Where the warehouse released this excess to when approving a request, per
    // project. Separate from the above: one entry can go to several projects.
    public List<ExcessWarehouseReleaseDto> WarehouseReleases { get; set; } = [];
}

public class ExcessWarehouseReleaseDto
{
    public string  ProjectName { get; set; } = string.Empty;
    public decimal Quantity    { get; set; }
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
    // What Actual Usage is computed from on save: the delivered quantity
    // (EstimatedQuantity until something's been marked Delivered)...
    public decimal  DeliveredQuantity { get; set; }
    // ...minus all excess + waste already logged against this line. Lets the
    // modal preview the same Actual Usage the save will store.
    public decimal  AlreadyLogged     { get; set; }
    public decimal  ExcessLogged      { get; set; }
    public decimal  WasteLogged       { get; set; }
    // Undecided redistribution request out of this project for the material
    // — no new excess/waste until it's settled.
    public bool     RedistributionPending { get; set; }
}

// Record Material Excess "None": BOQ lines with no excess or waste left.
public class ConfirmNoExcessWasteDto
{
    public int ProjectId { get; set; }
    public List<int> BOQItemIds { get; set; } = [];
}
