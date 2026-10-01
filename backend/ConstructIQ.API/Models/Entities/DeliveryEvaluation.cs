using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

// One evaluation per delivered PO — submitted once, together with proof-of-
// delivery photos, at the moment a PO is marked Delivered.
public class DeliveryEvaluation
{
    public int Id { get; set; }

    public int PurchaseOrderId { get; set; }
    public PurchaseOrder PurchaseOrder { get; set; } = null!;

    // Each 1-5. Their mean is the transaction's overall rating.
    public int PriceRating          { get; set; }
    public int DeliveryRating       { get; set; }
    public int QualityRating        { get; set; }
    public int AccuracyRating       { get; set; }
    public int ResponsivenessRating { get; set; }

    public bool OnTime { get; set; }
    public int  ActualLeadDays { get; set; }

    public string? Comments { get; set; }

    public int  RatedByUserId { get; set; }
    public User RatedBy       { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<DeliveryPhoto> Photos { get; set; } = [];
}

public class DeliveryPhoto
{
    public int Id { get; set; }

    public int DeliveryEvaluationId { get; set; }
    public DeliveryEvaluation DeliveryEvaluation { get; set; } = null!;

    [Required, MaxLength(255)]
    public string Url { get; set; } = string.Empty;
}
