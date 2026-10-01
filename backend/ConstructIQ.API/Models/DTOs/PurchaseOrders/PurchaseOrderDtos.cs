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
    // The master PO document — uploaded once, with the first delivery batch,
    // and reused by every later one. See PurchaseOrder.PoFileUrl.
    public string? PoFileUrl { get; init; }
}

public record DeliveryBatchDto
{
    public int      Id             { get; init; }
    public int      BatchNumber    { get; init; }
    public string   UploadedByName { get; init; } = "";
    public DateTime CreatedAt      { get; init; }
    // Split by DeliveryDocumentType rather than one flat PhotoUrls list — a
    // batch always has exactly one Delivery Receipt and one-or-more Proof of
    // Delivery photos, and the frontend needs to render them as distinct,
    // separately-labeled dropzones/sections.
    public string?       DrFileUrl    { get; init; }
    public List<string>  PodPhotoUrls { get; init; } = [];
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

// Bound from multipart/form-data — one batch's documents. Saved while a PO
// is DeliveryInProgress; a PO can have any number of these before "Delivery
// Complete" moves it to Delivered. PoFile is only required/used on the very
// first batch (see PurchaseOrdersController.AddDeliveryBatch) — every batch
// after that reuses PurchaseOrder.PoFileUrl instead, so the frontend simply
// stops sending it from Batch 2 onward.
public class SubmitDeliveryBatchDto
{
    public IFormFile? PoFile { get; set; }
    public IFormFile? DrFile { get; set; }
    public List<IFormFile> PodPhotos { get; set; } = [];
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
