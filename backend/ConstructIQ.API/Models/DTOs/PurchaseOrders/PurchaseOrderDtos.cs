namespace ConstructIQ.API.Models.DTOs.PurchaseOrders;

public class PurchaseOrderMaterialDto
{
    public int?    Id             { get; set; } // present on read, absent on create
    public string  Name           { get; set; } = "";
    public decimal Quantity       { get; set; }
    public string  Unit           { get; set; } = "";
    // Best-effort/explicit links back to the real catalog/BOQ — see PurchaseOrderMaterial.
    public int?    MaterialId     { get; set; }
    public int?    BOQItemId      { get; set; }
    public int?    PhaseId        { get; set; }
    public string? PrimarySection { get; set; }
    public string? SubCategory    { get; set; }
}

public record PurchaseOrderDto
{
    public int      Id           { get; init; }
    public string   Number       { get; init; } = "";
    public int      ProjectId    { get; init; }
    public string   ProjectName  { get; init; } = "";
    public int      SupplierId   { get; init; }
    public string   SupplierName { get; init; } = "";
    public string   Status       { get; init; } = "";
    public DateTime OrderDate    { get; init; }
    public DateTime ExpectedDate { get; init; }
    public List<PurchaseOrderMaterialDto> Materials { get; init; } = [];
}

public record CreatePurchaseOrderDto
{
    public int       ProjectId    { get; init; }
    public string    SupplierName { get; init; } = "";
    public DateTime? OrderDate    { get; init; } // null = now (live order placed today)
    public DateTime  ExpectedDate { get; init; }
    public List<PurchaseOrderMaterialDto> Materials { get; init; } = [];
}

public record UpdatePurchaseOrderStatusDto(string Status);

public record LinkPurchaseOrderMaterialDto(int? BOQItemId);

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
