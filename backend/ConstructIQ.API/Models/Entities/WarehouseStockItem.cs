using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// A snapshot of the warehouse's general Stock Balance sheet — not tied to
// any project, mirroring the source Google Sheet exactly (Material, Unit,
// Balance). Each sync replaces every row wholesale rather than diffing,
// since the sheet gives no per-row change-tracking to diff against.
public class WarehouseStockItem
{
    public int Id { get; set; }

    [Required, MaxLength(200)]
    public string MaterialName { get; set; } = string.Empty;

    [Required, MaxLength(50)]
    public string Unit { get; set; } = string.Empty;

    [Column(TypeName = "decimal(18,4)")]
    public decimal Balance { get; set; }

    public DateTime SyncedAt { get; set; } = DateTime.UtcNow;
}
