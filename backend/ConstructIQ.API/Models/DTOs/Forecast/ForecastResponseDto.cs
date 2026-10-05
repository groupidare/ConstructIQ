using System.Text.Json.Serialization;

namespace ConstructIQ.API.Models.DTOs.Forecast;

public class ForecastRequestDto
{
    public int     ProjectId     { get; set; }
    public int?    PhaseId       { get; set; }
    public string  Period        { get; set; } = "Monthly";
    public int?    PlanningWeeks { get; set; }
}

// Frontend-facing — serialized to the browser using ASP.NET's default camelCase
// policy (forecastedMaterials, materialId, ...). Never deserialize the ML
// service's snake_case response directly into this; use MlForecastResponseDto
// for that (see below) and map across in ForecastService.
public class ForecastResponseDto
{
    public int    Id          { get; set; }
    public int    ProjectId   { get; set; }
    public int?   PhaseId     { get; set; }
    public string Period      { get; set; } = string.Empty;
    public DateTime GeneratedAt { get; set; }
    public decimal? ModelAccuracy { get; set; }
    public List<ForecastedMaterialDto> ForecastedMaterials { get; set; } = [];
    // Per-BOQ-row predictions behind ForecastedMaterials (which sums them per
    // material+unit). Only filled on the response to a Generate Forecast
    // call, straight from the ML service — never persisted, so always empty
    // when reading saved forecast history (GetByProjectAsync).
    public List<ForecastedLineDto> LineForecasts { get; set; } = [];
}

public class ForecastedLineDto
{
    public int     BOQItemId          { get; set; }
    public int     MaterialId         { get; set; }
    public string  Unit               { get; set; } = string.Empty;
    public decimal ForecastedQuantity { get; set; }
    // False when Unit is just the row's BOQ unit (no purchase unit known for
    // this row/material) — see MlForecastedLineDto.PurchaseUnitKnown.
    public bool    PurchaseUnitKnown  { get; set; }
}

public class ForecastedMaterialDto
{
    public int     MaterialId         { get; set; }
    public string  MaterialName       { get; set; } = string.Empty;
    public string  Unit               { get; set; } = string.Empty;
    public decimal ForecastedQuantity { get; set; }
    public decimal CurrentStock       { get; set; }
    public decimal Shortage           { get; set; }
    public decimal ReorderSuggestion  { get; set; }
    public string  RiskLevel          { get; set; } = string.Empty;
}

// Wire-format mirror of the ML service's POST /forecast/predict response
// (snake_case) — deserialize into this, then map into ForecastResponseDto
// before returning anything to the frontend or saving to the DB.
public class MlForecastResponseDto
{
    [JsonPropertyName("project_id")]           public int     ProjectId     { get; set; }
    [JsonPropertyName("phase_id")]              public int?    PhaseId       { get; set; }
    public string  Period        { get; set; } = string.Empty;
    [JsonPropertyName("model_accuracy")]        public decimal? ModelAccuracy { get; set; }
    [JsonPropertyName("forecasted_materials")]  public List<MlForecastedMaterialDto> ForecastedMaterials { get; set; } = [];
    [JsonPropertyName("line_forecasts")]        public List<MlForecastedLineDto> LineForecasts { get; set; } = [];
}

public class MlForecastedLineDto
{
    [JsonPropertyName("boq_item_id")]          public int     BOQItemId          { get; set; }
    [JsonPropertyName("material_id")]          public int     MaterialId         { get; set; }
    public string  Unit               { get; set; } = string.Empty;
    [JsonPropertyName("forecasted_quantity")]  public decimal ForecastedQuantity { get; set; }
    // False when the ML service only had the row's BOQ unit to label this
    // prediction with (no purchase unit on the row, material never seen in
    // training). Defaults to true for an older ML service that never sends it.
    [JsonPropertyName("purchase_unit_known")]  public bool    PurchaseUnitKnown  { get; set; } = true;
}

public class MlForecastedMaterialDto
{
    [JsonPropertyName("material_id")]          public int     MaterialId         { get; set; }
    [JsonPropertyName("material_name")]        public string  MaterialName       { get; set; } = string.Empty;
    public string  Unit               { get; set; } = string.Empty;
    [JsonPropertyName("forecasted_quantity")]  public decimal ForecastedQuantity { get; set; }
    [JsonPropertyName("current_stock")]        public decimal CurrentStock       { get; set; }
    [JsonPropertyName("shortage")]             public decimal Shortage           { get; set; }
    [JsonPropertyName("reorder_suggestion")]   public decimal ReorderSuggestion  { get; set; }
    [JsonPropertyName("risk_level")]           public string  RiskLevel          { get; set; } = string.Empty;
}

public class ForecastAccuracyReportDto
{
    public int     ProjectId       { get; set; }
    public string  ProjectName     { get; set; } = string.Empty;
    public decimal OverallAccuracy { get; set; }
    public decimal Mae             { get; set; }
    public decimal Rmse            { get; set; }
    public List<ForecastComparisonDto> Comparisons { get; set; } = [];
}

public class ForecastComparisonDto
{
    public int     MaterialId         { get; set; }
    public string  MaterialName       { get; set; } = string.Empty;
    public string  Unit               { get; set; } = string.Empty;
    public decimal ForecastedQuantity { get; set; }
    public decimal ActualQuantity     { get; set; }
    public decimal Variance           { get; set; }
    public decimal VariancePercent    { get; set; }
    public decimal AccuracyPercent    { get; set; }
}

public class ModelMetricsDto
{
    public decimal Mae  { get; set; }
    public decimal Rmse { get; set; }
    public decimal R2   { get; set; }
}

// Frontend-facing — camelCase, same reasoning as ForecastResponseDto above.
public class TrainModelsResponseDto
{
    public int             SampleCount  { get; set; }
    public ModelMetricsDto RandomForest { get; set; } = new();
    public ModelMetricsDto Xgboost      { get; set; } = new();
}

// Wire-format mirror of the ML service's POST /forecast/train response.
public class MlTrainModelsResponseDto
{
    [JsonPropertyName("sample_count")]  public int             SampleCount  { get; set; }
    [JsonPropertyName("random_forest")] public ModelMetricsDto RandomForest { get; set; } = new();
    [JsonPropertyName("xgboost")]       public ModelMetricsDto Xgboost      { get; set; } = new();
    [JsonPropertyName("evaluations")]   public List<MlProjectEvaluationDto> Evaluations { get; set; } = [];
}

// One historical project's leave-one-project-out evaluation forecast — see
// training_service.py's _leave_one_project_out and ForecastService.
// SaveEvaluationForecastsAsync.
public class MlProjectEvaluationDto
{
    [JsonPropertyName("project_id")]           public int     ProjectId { get; set; }
    // Set when the evaluation couldn't use a model fitted on other projects
    // (too few other rows, or none at all) — says what stood in instead.
    [JsonPropertyName("note")]                 public string? Note      { get; set; }
    [JsonPropertyName("forecasted_materials")] public List<MlForecastedMaterialDto> ForecastedMaterials { get; set; } = [];
}
