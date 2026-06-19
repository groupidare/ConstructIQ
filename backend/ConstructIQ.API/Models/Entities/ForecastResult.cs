using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum ForecastPeriod { Weekly, Monthly, PhaseEnd }
public enum RiskLevel      { Low, Medium, High, Critical }

public class ForecastResult
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int? PhaseId { get; set; }
    public Phase? Phase { get; set; }

    public ForecastPeriod Period     { get; set; }
    public int?           PlanningWeeks { get; set; }

    [Column(TypeName = "decimal(5,2)")]
    public decimal? ModelAccuracy { get; set; }

    public string? Notes { get; set; }
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;

    public int? GeneratedByUserId { get; set; }
    public User? GeneratedBy { get; set; }

    public ICollection<ForecastedMaterial> ForecastedMaterials { get; set; } = [];
}

public class ForecastedMaterial
{
    public int Id { get; set; }

    public int ForecastResultId { get; set; }
    public ForecastResult ForecastResult { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    [Column(TypeName = "decimal(18,4)")] public decimal ForecastedQuantity { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal CurrentStock       { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal Shortage           { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal ReorderSuggestion  { get; set; }

    public RiskLevel RiskLevel { get; set; }
}
