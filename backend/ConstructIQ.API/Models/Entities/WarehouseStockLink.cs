using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

// A person's answer to "which warehouse item is this BOQ wording?", kept for
// that wording in every project. Holds the item's name, not its id: each sheet
// sync replaces every WarehouseStockItem, so ids don't last.
public class WarehouseStockLink
{
    public int Id { get; set; }

    [Required, MaxLength(500)]
    public string BoqName { get; set; } = string.Empty;

    // BoqName ignoring case and spacing — what makes two rows the same wording.
    [Required, MaxLength(500)]
    public string BoqNameKey { get; set; } = string.Empty;

    // Null: the warehouse doesn't carry this, as confirmed by whoever answered.
    [MaxLength(200)]
    public string? WarehouseMaterialName { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
