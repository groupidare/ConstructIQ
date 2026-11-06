using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// How much of a project's logged Excess a warehouse release used up — see
// OldestExcessFirst. A release with none came from regular stock.
public class WarehouseReleaseSource
{
    public int Id { get; set; }

    public int WarehouseRequestId { get; set; }
    public WarehouseRequest WarehouseRequest { get; set; } = null!;

    public int ExcessWasteRecordId { get; set; }
    public ExcessWasteRecord ExcessWasteRecord { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal Quantity { get; set; }
}
