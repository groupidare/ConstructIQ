using System.Text.Json.Serialization;

namespace ConstructIQ.API.Models.DTOs.Document;

public class ProjectDocumentDto
{
    public int      Id            { get; set; }
    public int      ProjectId     { get; set; }
    public string   ProjectName   { get; set; } = string.Empty;
    public string   Category      { get; set; } = string.Empty;
    public string?  CategoryOther { get; set; }
    public string?  Description   { get; set; }
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

// ── Purchase Order scan — same ML service, POST /documents/parse-po ────────────

public class MlParsedPoItem
{
    [JsonPropertyName("material_name")]           public string  MaterialName          { get; set; } = string.Empty;
    [JsonPropertyName("unit")]                     public string  Unit                  { get; set; } = string.Empty;
    [JsonPropertyName("actual_quantity_ordered")]  public double  ActualQuantityOrdered { get; set; }
    [JsonPropertyName("supplier_name")]            public string? SupplierName          { get; set; }
    [JsonPropertyName("order_date")]               public string? OrderDate             { get; set; }
    [JsonPropertyName("promised_delivery_date")]   public string? PromisedDeliveryDate  { get; set; }
    [JsonPropertyName("phase_hint")]                public string? PhaseHint             { get; set; }
}

public class MlDocumentParsePoResponse
{
    [JsonPropertyName("project_id")]   public int                  ProjectId   { get; set; }
    [JsonPropertyName("items")]        public List<MlParsedPoItem> Items       { get; set; } = [];
    [JsonPropertyName("page_count")]   public int                  PageCount   { get; set; }
    [JsonPropertyName("parse_errors")] public List<string>         ParseErrors { get; set; } = [];
}

public class ParsedPoRowDto
{
    public string   MaterialName          { get; set; } = string.Empty;
    public string   Unit                  { get; set; } = string.Empty;
    public decimal  ActualQuantityOrdered { get; set; }
    public string?  SupplierName          { get; set; }
    public DateTime? OrderDate            { get; set; }
    public DateTime? PromisedDeliveryDate { get; set; }
    public string?  PhaseHint             { get; set; }
    public int?     MatchedMaterialId     { get; set; }
    public int?     MatchedSupplierId     { get; set; }
}

public class PoParseResultDto
{
    public int                  PageCount   { get; set; }
    public List<string>         ParseErrors { get; set; } = [];
    public List<ParsedPoRowDto> Items       { get; set; } = [];
}
