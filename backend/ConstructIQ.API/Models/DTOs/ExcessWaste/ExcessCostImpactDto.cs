namespace ConstructIQ.API.Models.DTOs.ExcessWaste;

// ₱ value of logged excess and waste — material cost only, at the latest
// recorded price (see MaterialCostService.GetExcessCostImpactAsync).
public class ExcessCostImpactDto
{
    public string    Currency        { get; set; } = "PHP";
    // Reusable excess — money tied up in leftover material that can still be
    // used or redistributed.
    public decimal   ExcessValue     { get; set; }
    // Non-reusable waste — money lost.
    public decimal   WasteCost       { get; set; }
    public decimal   TotalCost       { get; set; }
    // Approved redistribution transfers out of these projects — excess
    // reused elsewhere instead of bought again.
    public decimal   RedistributedValue { get; set; }
    // Delivered PO lines — what excess + waste is a share of.
    public decimal   PurchasedValue  { get; set; }
    public int       PricedRecords   { get; set; }
    public int       UnpricedRecords { get; set; }
    public int       UnpricedTransfers  { get; set; }
    public int       UnpricedDeliveries { get; set; }
    // Range of the dated prices actually used (catalog prices carry no date).
    public DateTime? OldestPriceDate { get; set; }
    public DateTime? NewestPriceDate { get; set; }

    public List<ExcessCostByProjectDto> ByProject { get; set; } = [];
    public List<ExcessCostTrendDto> MonthlyTrend { get; set; } = [];
    // Empty unless the caller may see prices (Admin/ProcurementOfficer).
    public List<ExcessCostByMaterialDto> ByMaterial { get; set; } = [];
}

public class ExcessCostByProjectDto
{
    public int     ProjectId       { get; set; }
    public string  ProjectName     { get; set; } = string.Empty;
    public decimal ExcessValue     { get; set; }
    public decimal WasteCost       { get; set; }
    public decimal RedistributedValue { get; set; }
    public decimal PurchasedValue  { get; set; }
    public int     UnpricedRecords { get; set; }
}

public class ExcessCostTrendDto
{
    public string  Month              { get; set; } = string.Empty; // yyyy-MM
    public decimal ExcessValue        { get; set; }
    public decimal WasteCost          { get; set; }
    public decimal RedistributedValue { get; set; }
}

public class ExcessCostByMaterialDto
{
    public int     MaterialId     { get; set; }
    public string  MaterialName   { get; set; } = string.Empty;
    public string  Unit           { get; set; } = string.Empty;
    public decimal UnitPrice      { get; set; }
    public decimal ExcessQuantity { get; set; }
    public decimal WasteQuantity  { get; set; }
    public decimal ExcessValue    { get; set; }
    public decimal WasteCost      { get; set; }
}
