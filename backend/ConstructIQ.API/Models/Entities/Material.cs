using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public class MaterialCategory
{
    public int Id { get; set; }
    [Required, MaxLength(100)] public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public ICollection<Material> Materials { get; set; } = [];
}

public class Material
{
    public int Id { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(200)]
    public string Specification { get; set; } = string.Empty;

    [Required, MaxLength(50)]
    public string Unit { get; set; } = string.Empty;

    public int CategoryId { get; set; }
    public MaterialCategory Category { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")]
    public decimal UnitCost { get; set; }

    public bool IsActive { get; set; } = true;

    public ICollection<BOQItem>          BOQItems          { get; set; } = [];
    public ICollection<InventoryRecord>  InventoryRecords  { get; set; } = [];
}
