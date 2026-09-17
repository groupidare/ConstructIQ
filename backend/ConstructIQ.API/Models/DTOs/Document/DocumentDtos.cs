using System.Text.Json.Serialization;

namespace ConstructIQ.API.Models.DTOs.Document;

public class ProjectDocumentDto
{
    public int      Id          { get; set; }
    public int      ProjectId   { get; set; }
    public string   Category    { get; set; } = string.Empty;
    public string   FileName    { get; set; } = string.Empty;
    // Relative — e.g. "/uploads/5/guid_plan.pdf". Prefix with the API's origin (not
    // the "/api" base) to get a fetchable URL.
    public string   Url         { get; set; } = string.Empty;
    public long     SizeBytes   { get; set; }
    public string   UploadedBy  { get; set; } = string.Empty;
    public DateTime UploadedAt  { get; set; }
}

// ── ML service wire types (POST /documents/parse on the Python service) ────────
// Field names must match ml-service/app/models/schemas.py exactly (snake_case).

public class MlDocumentParseRequest
{
    [JsonPropertyName("file_path")]  public string FilePath  { get; set; } = string.Empty;
    [JsonPropertyName("project_id")] public int    ProjectId { get; set; }
}

public class MlParsedBoqItem
{
    [JsonPropertyName("material_name")]      public string  MaterialName      { get; set; } = string.Empty;
    [JsonPropertyName("specification")]      public string  Specification     { get; set; } = string.Empty;
    [JsonPropertyName("unit")]               public string  Unit              { get; set; } = string.Empty;
    [JsonPropertyName("estimated_quantity")] public double  EstimatedQuantity { get; set; }
    [JsonPropertyName("phase_hint")]         public string? PhaseHint         { get; set; }
}

public class MlDocumentParseResponse
{
    [JsonPropertyName("project_id")]   public int                   ProjectId   { get; set; }
    [JsonPropertyName("items")]        public List<MlParsedBoqItem> Items       { get; set; } = [];
    [JsonPropertyName("page_count")]   public int                   PageCount   { get; set; }
    [JsonPropertyName("parse_errors")] public List<string>          ParseErrors { get; set; } = [];
}

// ── What the frontend actually consumes — review rows, nothing persisted yet ───

public class ParsedBoqRowDto
{
    public string  MaterialName      { get; set; } = string.Empty;
    public string  Specification     { get; set; } = string.Empty;
    public string  Unit              { get; set; } = string.Empty;
    public decimal EstimatedQuantity { get; set; }
    public string? PhaseHint         { get; set; }
    // Best-effort exact-name match against the Materials catalog, so the frontend
    // can pre-select an existing material instead of always treating it as new.
    public int?    MatchedMaterialId { get; set; }
}

public class DocumentParseResultDto
{
    public int                   PageCount   { get; set; }
    public List<string>          ParseErrors { get; set; } = [];
    public List<ParsedBoqRowDto> Items       { get; set; } = [];
}

// ── Measurement (dimension) scan — same ML service, different endpoint ────────
// Best-effort text/OCR extraction, not a trained model. See dimension_extractor.py.

public class MlParsedMeasurementItem
{
    [JsonPropertyName("element_type")] public string  ElementType { get; set; } = string.Empty;
    [JsonPropertyName("length_m")]      public double  LengthM     { get; set; }
    [JsonPropertyName("width_m")]       public double  WidthM      { get; set; }
    [JsonPropertyName("height_m")]      public double  HeightM     { get; set; }
    [JsonPropertyName("thickness_m")]   public double  ThicknessM  { get; set; }
    [JsonPropertyName("area_label")]    public string? AreaLabel   { get; set; }
    [JsonPropertyName("source_page")]   public int     SourcePage  { get; set; }
    [JsonPropertyName("ocr_used")]      public bool    OcrUsed     { get; set; }
}

public class MlDocumentParseMeasurementsResponse
{
    [JsonPropertyName("project_id")]     public int                          ProjectId     { get; set; }
    [JsonPropertyName("items")]          public List<MlParsedMeasurementItem> Items        { get; set; } = [];
    [JsonPropertyName("page_count")]     public int                          PageCount     { get; set; }
    [JsonPropertyName("ocr_pages_used")] public int                          OcrPagesUsed  { get; set; }
    [JsonPropertyName("parse_errors")]   public List<string>                ParseErrors   { get; set; } = [];
}

public class ParsedMeasurementRowDto
{
    public string  ElementType { get; set; } = string.Empty;
    public decimal LengthM     { get; set; }
    public decimal WidthM      { get; set; }
    public decimal HeightM     { get; set; }
    public decimal ThicknessM  { get; set; }
    public string? AreaLabel   { get; set; }
    public int     SourcePage  { get; set; }
    public bool    OcrUsed     { get; set; }
}

public class MeasurementParseResultDto
{
    public int                          PageCount    { get; set; }
    public int                          OcrPagesUsed { get; set; }
    public List<string>                 ParseErrors  { get; set; } = [];
    public List<ParsedMeasurementRowDto> Items        { get; set; } = [];
}
