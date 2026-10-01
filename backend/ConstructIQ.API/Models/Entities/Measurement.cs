using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

// Wall/Column/Beam/Slab/Footing — drives the volume/area formula for this specific
// row. Per-measurement, not a single project-wide toggle (fixes a frontend bug
// where one "Structure Type" choice was shared across every phase).
public enum ElementType { Wall, Column, Beam, Slab, Footing }

public class Measurement
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int PhaseId { get; set; }
    public Phase Phase { get; set; } = null!;

    public ElementType ElementType { get; set; }

    [MaxLength(150)]
    public string? AreaLabel { get; set; }

    [Column(TypeName = "decimal(10,3)")] public decimal LengthM    { get; set; }
    [Column(TypeName = "decimal(10,3)")] public decimal WidthM     { get; set; }
    [Column(TypeName = "decimal(10,3)")] public decimal HeightM    { get; set; }
    [Column(TypeName = "decimal(10,3)")] public decimal ThicknessM { get; set; } = 0.10m;

    // Computed client-side on entry, stored so history/reports don't need to recompute.
    [Column(TypeName = "decimal(12,3)")] public decimal AreaSqm   { get; set; }
    [Column(TypeName = "decimal(12,3)")] public decimal VolumeCbm { get; set; }

    [MaxLength(30)]
    public string ConcreteMixRatio { get; set; } = "1:2:4";

    [Column(TypeName = "decimal(5,2)")]
    public decimal WasteAllowancePct { get; set; } = 12.00m;

    public int RecordedByUserId { get; set; }
    public User RecordedBy { get; set; } = null!;

    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}
