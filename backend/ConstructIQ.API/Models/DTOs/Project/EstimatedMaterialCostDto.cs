namespace ConstructIQ.API.Models.DTOs.Project;

// Material cost only — no labor, equipment, overhead or contingency. Just the
// total; per-item prices are deliberately not exposed here.
public class EstimatedMaterialCostDto
{
    public int       ProjectId          { get; set; }
    public decimal   TotalEstimatedCost { get; set; }
    public string    Currency           { get; set; } = "PHP";
    public int       PricedItems        { get; set; }
    public int       UnpricedItems      { get; set; }
    // Range of the dated prices actually used (catalog prices carry no date).
    public DateTime? OldestPriceDate    { get; set; }
    public DateTime? NewestPriceDate    { get; set; }
}
