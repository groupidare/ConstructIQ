using ConstructIQ.API.Models.DTOs.PurchaseOrders;

namespace ConstructIQ.API.Models.DTOs.MaterialRequests;

public record CreateMaterialRequestDto
{
    public int ProjectId { get; init; }
    public int MaterialId { get; init; }
    public decimal Quantity { get; init; }
    public string? Unit { get; init; }
    public int? BOQItemId { get; init; }
}

public record MaterialRequestDto
{
    public bool IsAdditional { get; init; }
    public int Id { get; init; }
    public int MaterialId { get; init; }
    public string MaterialName { get; init; } = "";
    public decimal Quantity { get; init; }
    public string Unit { get; init; } = "";
    public string RequestedByName { get; init; } = "";
    public DateTime CreatedAt { get; init; }
    // Price per unit on the most recent PO line for this material in the same
    // unit, from any supplier — shown as a reference beside the quotes.
    public decimal? LastUnitPrice { get; init; }
    public string? LastUnitPriceSupplier { get; init; }
    // The material's catalog specification — the form's "Size" column.
    public string Specification { get; init; } = "";
    public string? Remarks { get; init; }
    public List<MaterialRequestQuoteDto> Quotes { get; init; } = [];
}

public record MaterialRequestQuoteDto
{
    public int Slot { get; init; }
    public string SupplierName { get; init; } = "";
    public decimal? UnitPrice { get; init; }
    public bool PriceFromHistory { get; init; }
    public bool IsSelected { get; init; }
}

// Saves the quotes and remarks typed on the form without generating a PO yet.
public record SaveRequestQuotesDto
{
    public List<RequestQuotesDto> Requests { get; init; } = [];
}

public record RequestQuotesDto
{
    public int RequestId { get; init; }
    public string? Remarks { get; init; }
    public List<MaterialRequestQuoteDto> Quotes { get; init; } = [];
    // The requested quantity as edited on the form; null leaves it unchanged.
    public decimal? Quantity { get; init; }
}

public record ProjectWithRequestsDto
{
    public int ProjectId { get; init; }
    public string ProjectName { get; init; } = "";
    public int PendingCount { get; init; }
}

public record SuggestedSupplierDto
{
    public int Id { get; init; }
    public string Name { get; init; } = "";
    public double Rating { get; init; }
    public int OnTimePct { get; init; }
    public int Deliveries { get; init; }
    // True when this supplier has a real order history for the exact material
    // being requested — these are ranked ahead of a supplier who merely rates
    // well overall but has never actually supplied it.
    public bool HasHistoryWithMaterial { get; init; }
    // This supplier's price on its most recent PO line for the material, in
    // the requested unit — auto-fills the quote when the supplier is picked.
    public decimal? LastUnitPrice { get; init; }
    public DateTime? LastPriceDate { get; init; }
}

public record GeneratePOAssignmentDto
{
    public int RequestId { get; init; }
    public string SupplierName { get; init; } = "";
    // Price per unit entered by procurement; null when left blank.
    public decimal? UnitPrice { get; init; }
    // The supplier quotes compared on the form (up to 3). When given, the one
    // marked IsSelected decides the PO's supplier and price, and all of them
    // are kept on the request as its price comparison.
    public List<MaterialRequestQuoteDto> Quotes { get; init; } = [];
    public string? Remarks { get; init; }
    // The requested quantity as edited on the form; null leaves it unchanged.
    public decimal? Quantity { get; init; }
}

public record GeneratePOsFromRequestsDto
{
    public int ProjectId { get; init; }
    // Optional: when left out, each PO's expected delivery is today plus that
    // supplier's average actual lead time (7 days for a supplier with none).
    public DateTime? ExpectedDate { get; init; }
    public List<GeneratePOAssignmentDto> Assignments { get; init; } = [];
}

public record GeneratedPOsResultDto
{
    public List<PurchaseOrderDto> PurchaseOrders { get; init; } = [];
    // requestId -> PO number, so the overlay can show which PO each material
    // line landed on without a second round trip.
    public Dictionary<int, string> RequestPoNumbers { get; init; } = [];
}
