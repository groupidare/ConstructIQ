namespace ConstructIQ.API.Models.DTOs.Project;

// Material cost only — no labor, equipment, overhead or contingency.
// Projected total = Committed (what this project's POs already cost) +
// Remaining (what's still to be ordered × the latest recorded price).
// Lines carry unit prices, so the endpoint only serves the project's own
// Admin / Project Manager / Site Engineer (see CanViewProjectCostAsync).
public class EstimatedMaterialCostDto
{
    public int       ProjectId          { get; set; }
    // Committed + Remaining.
    public decimal   TotalEstimatedCost { get; set; }
    public decimal   CommittedCost      { get; set; }
    public decimal   RemainingCost      { get; set; }
    public string    Currency           { get; set; } = "PHP";
    public int       PricedItems        { get; set; }
    // Lines missing a price (or a forecast quantity) somewhere — their
    // unpriced part is left out of the totals, never guessed.
    public int       UnpricedItems      { get; set; }
    // Range of the dated prices actually used (catalog prices carry no date).
    public DateTime? OldestPriceDate    { get; set; }
    public DateTime? NewestPriceDate    { get; set; }
    public List<MaterialCostLineDto> Lines { get; set; } = [];
}

public class MaterialCostLineDto
{
    // Null for an ordered line that isn't in the Material Plan.
    public int?      BOQItemId         { get; set; }
    public string    MaterialName      { get; set; } = string.Empty;
    public string?   Specification     { get; set; }
    public string?   Section           { get; set; }
    public string    Unit              { get; set; } = string.Empty;
    // The Material Plan's forecasted purchase quantity; null when the row has none.
    public decimal?  ForecastQuantity  { get; set; }
    // Already on this project's POs (or historical purchases), in Unit.
    public decimal   OrderedQuantity   { get; set; }
    public decimal   CommittedCost     { get; set; }
    // Forecast − ordered, never below zero.
    public decimal   RemainingQuantity { get; set; }
    // Latest recorded price for this material in Unit — what Remaining is priced at.
    public decimal?  UnitPrice         { get; set; }
    // "Purchase order", "Past project" or "Material catalog".
    public string?   PriceSource       { get; set; }
    // e.g. "PO-014 · JS Builders" or the past project's name.
    public string?   PriceReference    { get; set; }
    public DateTime? PriceDate         { get; set; }
    public decimal   RemainingCost     { get; set; }
    public bool      NeedsPrice        { get; set; }
    // Why the line is partly or wholly left out, or where it came from.
    public string?   Note              { get; set; }
}
