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
    public List<DeliveryBatchDto> DeliveryBatches { get; init; } = [];
    // True once a WarehousePersonnel has rated this delivery — lets the
    // frontend show/hide the "Rate Supplier" action without a second call.
    public bool HasEvaluation { get; init; }
}

public record DeliveryBatchDto
{
    public int      Id             { get; init; }
    public int      BatchNumber    { get; init; }
    public string   UploadedByName { get; init; } = "";
    public DateTime CreatedAt      { get; init; }
    public List<string> PhotoUrls  { get; init; } = [];
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

// Bound from multipart/form-data — just the photos for one batch. Saved
// while a PO is DeliveryInProgress; a PO can have any number of these before
// "Delivery Complete" moves it to Delivered.
public class SubmitDeliveryBatchDto
{
    public List<IFormFile> Photos { get; set; } = [];
}

// Rating is its own step, submitted independently of any delivery batch and
// only ever by WarehousePersonnel — plain JSON, no photos (those already
// live on the PO's DeliveryBatches by the time a PO is Delivered).
public record SubmitRatingDto
{
    public int    PriceRating          { get; init; }
    public int    DeliveryRating       { get; init; }
    public int    QualityRating        { get; init; }
    public int    AccuracyRating       { get; init; }
    public int    ResponsivenessRating { get; init; }
    public bool   OnTime               { get; init; }
    public int    ActualLeadDays       { get; init; }
    public string? Comments            { get; init; }
}
