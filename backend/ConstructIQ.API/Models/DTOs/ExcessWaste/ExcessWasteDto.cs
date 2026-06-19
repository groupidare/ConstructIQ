using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.ExcessWaste;

public class ExcessWasteCreateDto
{
    [Required] public int     ProjectId   { get; set; }
    [Required] public int     PhaseId     { get; set; }
    [Required] public int     MaterialId  { get; set; }
    [Required] public string  ExcessType  { get; set; } = string.Empty;
    [Range(0.0001, double.MaxValue)] public decimal Quantity { get; set; }
    [Range(0, double.MaxValue)]      public decimal UnitCost { get; set; }
    public bool    IsReusable { get; set; }
    public string? Notes      { get; set; }
}

public class ExcessWasteResponseDto
{
    public int      Id           { get; set; }
    public int      ProjectId    { get; set; }
    public string   ProjectName  { get; set; } = string.Empty;
    public int      PhaseId      { get; set; }
    public string   PhaseName    { get; set; } = string.Empty;
    public int      MaterialId   { get; set; }
    public string   MaterialName { get; set; } = string.Empty;
    public string   Unit         { get; set; } = string.Empty;
    public string   ExcessType   { get; set; } = string.Empty;
    public decimal  Quantity     { get; set; }
    public decimal  UnitCost     { get; set; }
    public decimal  TotalCost    { get; set; }
    public decimal  ExcessPercent{ get; set; }
    public bool     IsReusable   { get; set; }
    public string?  Notes        { get; set; }
    public string   RecordedBy   { get; set; } = string.Empty;
    public DateTime RecordedAt   { get; set; }
}

public class ExcessAnalyticsSummaryDto
{
    public int     ProjectId           { get; set; }
    public string  ProjectName         { get; set; } = string.Empty;
    public decimal TotalExcessCost     { get; set; }
    public decimal TotalExcessQuantity { get; set; }
    public decimal ReusableValue       { get; set; }
    public List<ExcessByMaterialDto>   ExcessByMaterial { get; set; } = [];
    public List<MonthlyExcessTrendDto> MonthlyTrend     { get; set; } = [];
}

public class ExcessByMaterialDto
{
    public int     MaterialId     { get; set; }
    public string  MaterialName   { get; set; } = string.Empty;
    public decimal TotalQuantity  { get; set; }
    public decimal TotalCost      { get; set; }
    public decimal ExcessPercent  { get; set; }
}

public class MonthlyExcessTrendDto
{
    public string  Month         { get; set; } = string.Empty;
    public decimal TotalCost     { get; set; }
    public decimal TotalQuantity { get; set; }
}
