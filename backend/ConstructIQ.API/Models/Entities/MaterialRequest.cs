using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// A project's ask for more of a specific material — raised from the BOQ/Material
// Plan tab's "Notify Procurement" button. Lives independently of Notification
// (which is just a fire-and-forget alert): this is the trackable object a
// Procurement Officer fulfills by generating a real PurchaseOrder against it.
public class MaterialRequest
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")]
    public decimal Quantity { get; set; }

    [MaxLength(20)]
    public string Unit { get; set; } = string.Empty;

    // The BOQ row this is for. Null for requests made before rows were tracked,
    // or if the row has since been deleted — see ProcurementCapCalculator.
    public int? BOQItemId { get; set; }
    public BOQItem? BOQItem { get; set; }

    // Beyond what the row still needed when asked (breakage, a design change).
    public bool IsAdditional { get; set; }

    public int RequestedByUserId { get; set; }
    public User RequestedBy { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Null = still pending. Set the moment a Procurement Officer generates a
    // PO covering this request — that PO is the single source of truth for
    // what happened next, so there's no separate status enum to drift out of
    // sync with it.
    public int? FulfilledByPurchaseOrderId { get; set; }
    public PurchaseOrder? FulfilledByPurchaseOrder { get; set; }

    // The client's Material Request Form "Remarks" column — set by procurement.
    [MaxLength(300)]
    public string? Remarks { get; set; }

    // Up to MaxQuotes supplier quotations for this request, one of which is
    // chosen for the PO. Kept after the PO is generated — that's the record of
    // which suppliers were compared and at what price.
    public ICollection<MaterialRequestQuote> Quotes { get; set; } = [];

    // A price check, not an order: raised from the cost breakdown's "Request
    // quotation" for a material with no recorded price. Procurement only
    // enters supplier quotes for it — it never becomes a PO, never counts
    // against the material's requestable balance, and leaves the Requests
    // tab once a price is saved (that quote then prices the cost estimate).
    public bool IsPriceInquiry { get; set; }

    public const int MaxQuotes = 3;
}

public class MaterialRequestQuote
{
    public int Id { get; set; }

    public int MaterialRequestId { get; set; }
    public MaterialRequest MaterialRequest { get; set; } = null!;

    // 1–3: the column the quote sits in on the form.
    public int Slot { get; set; }

    [Required, MaxLength(200)]
    public string SupplierName { get; set; } = string.Empty;

    // Price per the request's Unit. Null when the supplier hasn't quoted yet.
    [Column(TypeName = "decimal(18,4)")]
    public decimal? UnitPrice { get; set; }

    // True when the price was filled in from this supplier's previous PO for
    // the same material and unit and then left unchanged; false once typed.
    public bool PriceFromHistory { get; set; }

    public bool IsSelected { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
