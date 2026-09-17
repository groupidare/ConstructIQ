using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public class BOQItem
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    // Nullable: a BOQ row is grouped by PrimarySection/SubCategory first (the real
    // BOQ taxonomy), and only optionally also tied to a specific project Phase.
    public int? PhaseId { get; set; }
    public Phase? Phase { get; set; }

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [MaxLength(100)] public string? PrimarySection { get; set; }
    [MaxLength(100)] public string? SubCategory    { get; set; }

    [Column(TypeName = "decimal(18,4)")]
    public decimal EstimatedQuantity { get; set; }

    [Column(TypeName = "decimal(18,4)")]
    public decimal ActualQuantity { get; set; } = 0;

    [Column(TypeName = "decimal(18,2)")]
    public decimal EstimatedUnitCost { get; set; }

    public string? Notes { get; set; }

    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
