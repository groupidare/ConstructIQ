using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Measurement;

public class MeasurementUpsertDto
{
    public int?    Id                { get; set; } // null = create new
    [Required] public int PhaseId    { get; set; }
    [Required] public string ElementType { get; set; } = string.Empty;
    public string? AreaLabel         { get; set; }
    public decimal LengthM           { get; set; }
    public decimal WidthM            { get; set; }
    public decimal HeightM           { get; set; }
    public decimal ThicknessM        { get; set; } = 0.10m;
    public string  ConcreteMixRatio  { get; set; } = "1:2:4";
    public decimal WasteAllowancePct { get; set; } = 12.00m;
}

public class MeasurementBulkSaveDto
{
    [Required] public int ProjectId { get; set; }
    public List<MeasurementUpsertDto> Items { get; set; } = [];
}

public class MeasurementResponseDto
{
    public int      Id                { get; set; }
    public int      ProjectId         { get; set; }
    public int      PhaseId           { get; set; }
    public string   PhaseName         { get; set; } = string.Empty;
    public string   ElementType       { get; set; } = string.Empty;
    public string?  AreaLabel         { get; set; }
    public decimal  LengthM           { get; set; }
    public decimal  WidthM            { get; set; }
    public decimal  HeightM           { get; set; }
    public decimal  ThicknessM        { get; set; }
    public decimal  AreaSqm           { get; set; }
    public decimal  VolumeCbm         { get; set; }
    public string   ConcreteMixRatio  { get; set; } = string.Empty;
    public decimal  WasteAllowancePct { get; set; }
    public DateTime RecordedAt        { get; set; }
}
