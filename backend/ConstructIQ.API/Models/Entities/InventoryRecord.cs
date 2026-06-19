using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum StockStatus { Normal, LowStock, Overstock, OutOfStock }

public class InventoryRecord
{
    public int Id { get; set; }

    public int ProjectId  { get; set; }
    public Project Project { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal AvailableQuantity { get; set; } = 0;
    [Column(TypeName = "decimal(18,4)")] public decimal UsedQuantity      { get; set; } = 0;
    [Column(TypeName = "decimal(18,4)")] public decimal WastedQuantity    { get; set; } = 0;
    [Column(TypeName = "decimal(18,4)")] public decimal ExcessQuantity    { get; set; } = 0;
    [Column(TypeName = "decimal(18,4)")] public decimal ReorderPoint      { get; set; } = 0;
    [Column(TypeName = "decimal(18,4)")] public decimal TargetStockLevel  { get; set; } = 0;

    public StockStatus StockStatus { get; set; } = StockStatus.Normal;

    public DateTime LastUpdated { get; set; } = DateTime.UtcNow;

    public ICollection<MaterialMovement> MaterialMovements { get; set; } = [];
}
