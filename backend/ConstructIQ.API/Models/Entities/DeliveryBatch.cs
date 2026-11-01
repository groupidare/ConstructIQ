using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

// The Purchase Order file itself is NOT one of these — it's a single master
// document that lives on PurchaseOrder.PoFileUrl, uploaded once on the first
// batch and reused for every later one (see PurchaseOrdersController), so
// there's no PurchaseOrder case here.
public enum DeliveryDocumentType
{
    DeliveryReceipt,
    ProofOfDelivery,
}

// One partial shipment's worth of delivery documents, saved while a PO is
// DeliveryInProgress. Warehouse personnel upload and save a batch each time
// part of the order arrives, then click "Delivery Complete" once the last
// one has. Rating (DeliveryEvaluation) is deliberately separate — it's
// submitted independently, only by WarehousePersonnel, regardless of how
// many batches it took to get here.
public class DeliveryBatch
{
    public int Id { get; set; }

    public int PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    // 1-based, sequential per PO — lets the overlay label batches in the
    // order they were saved.
    public int BatchNumber { get; set; }

    public int UploadedByUserId { get; set; }
    public User UploadedBy { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<DeliveryBatchPhoto> Photos { get; set; } = [];
}

public class DeliveryBatchPhoto
{
    public int Id { get; set; }

    public int DeliveryBatchId { get; set; }
    public DeliveryBatch DeliveryBatch { get; set; } = null!;

    [Required, MaxLength(500)]
    public string Url { get; set; } = string.Empty;

    // Rows saved before this column existed are all real proof-of-delivery
    // photos (that was the only thing a batch could hold back then) — the
    // migration backfills them as ProofOfDelivery, never DeliveryReceipt.
    public DeliveryDocumentType DocumentType { get; set; } = DeliveryDocumentType.ProofOfDelivery;
}
