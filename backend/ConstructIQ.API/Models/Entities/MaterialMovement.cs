using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum MovementType { Received, Released, Returned, Wasted, Transferred }

public class MaterialMovement
{
    public int Id { get; set; }

    public int InventoryRecordId { get; set; }
    public InventoryRecord InventoryRecord { get; set; } = null!;

    public int ProjectId  { get; set; }
    public int MaterialId { get; set; }

    public MovementType MovementType { get; set; }

    [Column(TypeName = "decimal(18,4)")]
    public decimal Quantity { get; set; }

    public int? PhaseId { get; set; }
    public Phase? Phase { get; set; }

    public string? Notes { get; set; }

    public int RecordedByUserId { get; set; }
    public User RecordedBy { get; set; } = null!;

    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}
