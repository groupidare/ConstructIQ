using ConstructIQ.API.Models.DTOs.PurchaseOrders;

namespace ConstructIQ.API.Models.DTOs.MaterialRequests;

public record CreateMaterialRequestDto
{
    public int ProjectId { get; init; }
    public int MaterialId { get; init; }
    public decimal Quantity { get; init; }
    public string? Unit { get; init; }
}

public record MaterialRequestDto
{
    public int Id { get; init; }
    public int MaterialId { get; init; }
    public string MaterialName { get; init; } = "";
    public decimal Quantity { get; init; }
    public string Unit { get; init; } = "";
    public string RequestedByName { get; init; } = "";
    public DateTime CreatedAt { get; init; }
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
}

public record GeneratePOAssignmentDto
{
    public int RequestId { get; init; }
    public string SupplierName { get; init; } = "";
}

public record GeneratePOsFromRequestsDto
{
    public int ProjectId { get; init; }
    public DateTime ExpectedDate { get; init; }
    public List<GeneratePOAssignmentDto> Assignments { get; init; } = [];
}

public record GeneratedPOsResultDto
{
    public List<PurchaseOrderDto> PurchaseOrders { get; init; } = [];
    // requestId -> PO number, so the overlay can show which PO each material
    // line landed on without a second round trip.
    public Dictionary<int, string> RequestPoNumbers { get; init; } = [];
}
