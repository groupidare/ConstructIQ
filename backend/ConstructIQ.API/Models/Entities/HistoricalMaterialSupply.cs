using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// One real, already-happened purchase line extracted from a historical
// project's combined BOQ+PO report — distinct from PurchaseOrder, which
// carries a live Pending/Approved/Delivered workflow that doesn't apply to
// something that already happened. Many of these can belong to one BOQItem
// (one BOQ line commonly explodes into several real materials/suppliers).
public class HistoricalMaterialSupply
{
    public int Id { get; set; }

    public int BOQItemId { get; set; }
    public BOQItem BOQItem { get; set; } = null!;

    public int? SupplierId { get; set; }
    public Supplier? Supplier { get; set; }

    [MaxLength(30)]  public string? PoNumber     { get; set; }
    [MaxLength(200)] public string  MaterialName { get; set; } = string.Empty;
    [MaxLength(20)]  public string  Unit         { get; set; } = string.Empty;

    [Column(TypeName = "decimal(18,4)")] public decimal Quantity { get; set; }
}
