using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Material;

public class MaterialPropertiesDto
{
    // One of UnitArea, CoverageRate, Volume, Count, Length — or null to clear.
    public string?  CalculationType  { get; set; }
    [Range(0.01, 1_000_000)] public decimal? LengthMm         { get; set; }
    [Range(0.01, 1_000_000)] public decimal? WidthMm          { get; set; }
    [Range(0.01, 1_000_000)] public decimal? ThicknessMm      { get; set; }
    [Range(0.01, 1_000_000)] public decimal? PiecesPerPackage { get; set; }
    [Range(0.0001, 1_000_000)] public decimal? CoveragePerUnit { get; set; }
    [MaxLength(20)]          public string?  CoverageUnit     { get; set; }
    [Range(0.001, 1_000)]    public decimal? UnitLengthM      { get; set; }
    [Range(1, 10)]           public int?     Coats            { get; set; }
    [MaxLength(20)]          public string?  PurchaseUnit     { get; set; }
    [MaxLength(200)]         public string?  PropertiesSource { get; set; }
}

public class MaterialResponseDto
{
    public int     Id            { get; set; }
    public string  Name          { get; set; } = string.Empty;
    public string  Specification { get; set; } = string.Empty;
    public string  Unit          { get; set; } = string.Empty;
    public string  CategoryName  { get; set; } = string.Empty;
    public bool    IsActive      { get; set; }
    public MaterialPropertiesDto Properties { get; set; } = new();
}

public class ApplyDefaultsResultDto
{
    public int Updated { get; set; }
    public List<string> Materials { get; set; } = [];
}
