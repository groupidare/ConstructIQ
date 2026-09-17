namespace ConstructIQ.API.Models.DTOs.PurchaseOrders;

public record PurchaseOrderMaterialDto(string Name, decimal Quantity, string Unit);

public record PurchaseOrderDto
{
    public int      Id           { get; init; }
    public string   Number       { get; init; } = "";
    public int      ProjectId    { get; init; }
    public string   ProjectName  { get; init; } = "";
    public int      SupplierId   { get; init; }
    public string   SupplierName { get; init; } = "";
    public string   Status       { get; init; } = "";
    public DateTime ExpectedDate { get; init; }
    public List<PurchaseOrderMaterialDto> Materials { get; init; } = [];
}

public record CreatePurchaseOrderDto
{
    public int      ProjectId    { get; init; }
    public string   SupplierName { get; init; } = "";
    public DateTime ExpectedDate { get; init; }
    public List<PurchaseOrderMaterialDto> Materials { get; init; } = [];
}

public record UpdatePurchaseOrderStatusDto(string Status);

// Bound from multipart/form-data (photos + scalar fields together), so this
// is a plain mutable class rather than a record.
public class SubmitDeliveryDto
{
    public int    PriceRating          { get; set; }
    public int    DeliveryRating       { get; set; }
    public int    QualityRating        { get; set; }
    public int    AccuracyRating       { get; set; }
    public int    ResponsivenessRating { get; set; }
    public bool   OnTime               { get; set; }
    public int    ActualLeadDays       { get; set; }
    public string? Comments            { get; set; }
    public List<IFormFile> Photos      { get; set; } = [];
}
