using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum ExcessType { Unused, Damaged, Expired, Overordered }

public class ExcessWasteRecord
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int? PhaseId { get; set; }
    public Phase? Phase { get; set; }

    public int MaterialId { get; set; }
    public Material Material { get; set; } = null!;

    // Which specific BOQ line this excess/waste was logged against — lets the
    // Record Material Excess modal build its material picker straight from
    // the project's real BOQ instead of free text, lets "how much of this
    // material still needs logging" be answered exactly (no BOQItemId here
    // yet == not logged yet), and is what drives BOQItem.ActualQuantity
    // (Est. Qty minus everything logged against it) once this is saved.
    public int? BOQItemId { get; set; }
    public BOQItem? BOQItem { get; set; }

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
