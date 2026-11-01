using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Blueprint;

// These classes are read from the ML service with its snake_case policy
// (ForecastService.MlJson) and returned to the frontend in camelCase, so the
// property names must stay the PascalCase form of the ML field names.

public class BlueprintParseRequestDto
{
    [MaxLength(40)] public string? Sheet { get; set; }
    [MaxLength(40)] public string? DrawingId { get; set; }
    [MaxLength(20)] public string? ScaleOverride { get; set; }
}

public class BlueprintDrawingDto
{
    public string  Id    { get; set; } = string.Empty;
    public string  Title { get; set; } = string.Empty;
    public string? Scale { get; set; }
}

public class BlueprintSheetDto
{
    public string Id    { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public List<BlueprintDrawingDto> Drawings { get; set; } = [];
}

public class BlueprintRoomDto
{
    public string  Name         { get; set; } = string.Empty;
    public double  FloorAreaSqm { get; set; }
    public double  PerimeterM   { get; set; }
    public double  LengthM      { get; set; }
    public double  WidthM       { get; set; }
    public double  Confidence   { get; set; }
    public List<string> Labels  { get; set; } = [];
}

public class BlueprintOpeningDto
{
    public string Type          { get; set; } = string.Empty; // door | window
    public int    Count         { get; set; }
    public double? WidthM       { get; set; }
    public double? HeightM      { get; set; }
    public bool   AssumedWidth  { get; set; }
    public bool   AssumedHeight { get; set; }
}

public class BlueprintScheduleCheckDto
{
    public double? PlanTotalSqm      { get; set; }
    public double? ExtractedTotalSqm { get; set; }
    public double? ClearTotalSqm     { get; set; }
    public double? DifferencePct     { get; set; }
}

public class BlueprintResultDto
{
    public List<BlueprintSheetDto>   Sheets          { get; set; } = [];
    public string?                   SelectedDrawing { get; set; }
    public List<BlueprintRoomDto>    Rooms           { get; set; } = [];
    public List<BlueprintOpeningDto> Openings        { get; set; } = [];
    public List<double>              CeilingHeightsM { get; set; } = [];
    public List<string>              FinishNotes     { get; set; } = [];
    public BlueprintScheduleCheckDto? ScheduleCheck  { get; set; }
    public List<string>              Warnings        { get; set; } = [];
    public List<string>              Errors          { get; set; } = [];
}

// ── Finish templates ─────────────────────────────────────────────────────────

public class FinishTemplateRowDto
{
    public string Name        { get; set; } = string.Empty;
    public string BoqUnit     { get; set; } = string.Empty;
    public string Basis       { get; set; } = string.Empty;
    public string SubCategory { get; set; } = string.Empty;
}

public class FinishTemplateDto
{
    public string  Key         { get; set; } = string.Empty;
    public string  Surface     { get; set; } = string.Empty; // floor | wall | ceiling | openings
    public string  Label       { get; set; } = string.Empty;
    public string? NotePattern { get; set; }
    public List<FinishTemplateRowDto> Rows { get; set; } = [];
}

public class FinishTemplatesDto
{
    public List<FinishTemplateDto> Templates { get; set; } = [];
}

// ── Generation ───────────────────────────────────────────────────────────────

public class RoomMeasurementInputDto
{
    [Required, MaxLength(150)] public string Room { get; set; } = string.Empty;
    [Range(0, 100_000)] public double FloorAreaSqm { get; set; }
    [Range(0, 100_000)] public double PerimeterM   { get; set; }
    [Range(0, 50)]      public double? HeightM     { get; set; }
    [Range(0, 100_000)] public double OpeningsSqm  { get; set; }
}

public class RoomFinishInputDto
{
    [Required, MaxLength(150)] public string Room { get; set; } = string.Empty;
    [MaxLength(60)] public string? Floor   { get; set; }
    [MaxLength(60)] public string? Wall    { get; set; }
    [MaxLength(60)] public string? Ceiling { get; set; }
}

public class OpeningInputDto
{
    [Required, MaxLength(20)] public string Type { get; set; } = string.Empty;
    [Range(0, 10_000)] public int Count { get; set; }
    public double? WidthM  { get; set; }
    public double? HeightM { get; set; }
}

public class GenerateFromBlueprintDto
{
    [Required] public int ProjectId { get; set; }
    [MaxLength(60)] public string? Source { get; set; }
    // Floor finish as one row per room (the Material Plan layout).
    public bool PerRoomFloor { get; set; }
    public List<RoomMeasurementInputDto> Measurements { get; set; } = [];
    public List<RoomFinishInputDto> Finishes { get; set; } = [];
    public List<OpeningInputDto> Openings { get; set; } = [];
}

public class GeneratedBaselineDto
{
    public double? BaselineQuantity { get; set; }
    public int?    PurchaseQuantity { get; set; }
    public string? PurchaseUnit     { get; set; }
    public string? FormulaText      { get; set; }
    public string? Reason           { get; set; }
}

public class GeneratedBoqRowDto
{
    public int?    MaterialId     { get; set; }
    public string? MaterialName   { get; set; }
    public string  Specification  { get; set; } = string.Empty;
    public string  BoqUnit        { get; set; } = string.Empty;
    public double  BoqQuantity    { get; set; }
    public string  PrimarySection { get; set; } = string.Empty;
    public string  SubCategory    { get; set; } = string.Empty;
    public string  SourceNote     { get; set; } = string.Empty;
    public string  Basis          { get; set; } = string.Empty;
    public string  TemplateKey    { get; set; } = string.Empty;
    public List<string> Rooms     { get; set; } = [];
    public GeneratedBaselineDto Baseline { get; set; } = new();
}

public class GeneratedBoqDto
{
    public List<GeneratedBoqRowDto> Rows { get; set; } = [];
    public List<string> Warnings { get; set; } = [];
}

// ── Merge with a provided BOQ ────────────────────────────────────────────────

public class MergeRowInputDto
{
    public int?    MaterialId     { get; set; }
    [MaxLength(300)] public string Specification { get; set; } = string.Empty;
    [MaxLength(20)]  public string BoqUnit       { get; set; } = string.Empty;
    public double  BoqQuantity    { get; set; }
    [MaxLength(100)] public string? PrimarySection { get; set; }
    [MaxLength(100)] public string? SubCategory    { get; set; }
}

public class MergePreviewRequestDto
{
    [Required] public int ProjectId  { get; set; }
    [Required] public int DocumentId { get; set; }
    public List<MergeRowInputDto> Rows { get; set; } = [];
}

public class MergeScannedRowDto
{
    public string   MaterialName      { get; set; } = string.Empty;
    public string?  Specification     { get; set; }
    public string   Unit              { get; set; } = string.Empty;
    public decimal  EstimatedQuantity { get; set; }
    public string?  PrimarySection    { get; set; }
    public string?  SubCategory       { get; set; }
    public int?     MatchedMaterialId { get; set; }
}

public static class MergeActions
{
    public const string Add = "add";             // not in the generated rows
    public const string Skip = "skip";           // same material + work item, within ±5% — confirmed
    public const string Flag = "flag";           // same material + work item, off by more than 5% (or another unit)
    public const string Incomplete = "incomplete"; // no quantity / unknown unit — the user completes or skips it
}

public class MergeResultRowDto
{
    public string  Action          { get; set; } = MergeActions.Add;
    public MergeScannedRowDto Scanned { get; set; } = new();
    public int?    GeneratedIndex  { get; set; }
    public double? GeneratedQuantity { get; set; }
    public double? DifferencePct   { get; set; }
    public string? Reason          { get; set; }
}

public class MergePreviewDto
{
    public List<MergeResultRowDto> Rows { get; set; } = [];
    public List<string> ParseErrors { get; set; } = [];
}
