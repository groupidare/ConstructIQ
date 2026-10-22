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

// How a material's physical properties turn a BOQ work quantity into
// purchase units — see Algorithms/BaselineCalculator (and its Python twin,
// ml-service/app/ml/baseline_engine.py). Explicit values: stored as int, and
// the ML service reads the same ints straight from the database.
public enum MaterialCalculationType
{
    UnitArea = 0,      // sq.m ÷ piece face area ÷ pieces per package (CHB, tiles, boards)
    CoverageRate = 1,  // sq.m × coats ÷ coverage per unit (adhesive, grout, paint)
    Volume = 2,        // cu.m ÷ cu.m per unit (cement, sand, gravel)
    Count = 3,         // pc/set ÷ pieces per package (doors, windows)
    Length = 4,        // l.m ÷ unit length (rebar, studs)
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

    // ── Physical properties (all optional) — feed the engineering baseline ──
    public MaterialCalculationType? CalculationType { get; set; }
    [Column(TypeName = "decimal(10,2)")] public decimal? LengthMm         { get; set; }
    [Column(TypeName = "decimal(10,2)")] public decimal? WidthMm          { get; set; }
    [Column(TypeName = "decimal(10,2)")] public decimal? ThicknessMm      { get; set; }
    [Column(TypeName = "decimal(10,2)")] public decimal? PiecesPerPackage { get; set; }
    // Work units one purchase unit covers, in CoverageUnit (e.g. 4.0 sq.m per
    // bag of adhesive, 0.1111 cu.m of 1:2:4 concrete per bag of cement).
    [Column(TypeName = "decimal(12,4)")] public decimal? CoveragePerUnit  { get; set; }
    [MaxLength(20)]                      public string?  CoverageUnit     { get; set; }
    [Column(TypeName = "decimal(10,3)")] public decimal? UnitLengthM      { get; set; }
    public int? Coats { get; set; }
    // The unit these properties describe and the baseline comes out in
    // (sheet, box, bag…). Many catalog rows carry the BOQ work unit (sq.m) as
    // Unit, so this can differ from it; null means "same as Unit".
    [MaxLength(20)]  public string? PurchaseUnit     { get; set; }
    [MaxLength(200)] public string? PropertiesSource { get; set; }

    public ICollection<BOQItem>          BOQItems          { get; set; } = [];
    public ICollection<InventoryRecord>  InventoryRecords  { get; set; } = [];
}
