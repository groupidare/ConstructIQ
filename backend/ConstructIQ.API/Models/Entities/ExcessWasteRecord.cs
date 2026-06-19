using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum ExcessType { Unused, Damaged, Expired, Overordered }

public class ExcessWasteRecord
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int PhaseId { get; set; }
    public Phase Phase { get; set; } = null!;

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    public ExcessType ExcessType { get; set; }

    [Column(TypeName = "decimal(18,4)")] public decimal Quantity      { get; set; }
    [Column(TypeName = "decimal(18,4)")] public decimal UnitCost      { get; set; }
    [Column(TypeName = "decimal(18,2)")] public decimal TotalCost     { get; set; }
    [Column(TypeName = "decimal(5,2)")]  public decimal ExcessPercent { get; set; }

    public bool IsReusable { get; set; } = false;
    public string? Notes { get; set; }

    public int RecordedByUserId { get; set; }
    public User RecordedBy { get; set; } = null!;

    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}
