using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

// One partial shipment's worth of proof-of-delivery photos, saved while a PO
// is DeliveryInProgress. Warehouse personnel upload and save a batch each
// time part of the order arrives, then click "Delivery Complete" once the
// last one has. Rating (DeliveryEvaluation) is deliberately separate — it's
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

    [Required, MaxLength(255)]
    public string Url { get; set; } = string.Empty;
}
