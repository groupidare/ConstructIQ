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
    // The trained model version that produced this forecast, and its
    // training-time confidence ("Normal"/"Low") — see ml-service model_registry.
    [JsonPropertyName("model_version")]         public string? ModelVersion    { get; set; }
    [JsonPropertyName("model_confidence")]      public string? ModelConfidence { get; set; }
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

// ── Model training workflow ──────────────────────────────────────────────────
// These mirror the ML service's training endpoints (POST /forecast/train,
// GET /forecast/model-status, GET /forecast/training-data) property for
// property. ForecastService deserializes the ML service's snake_case JSON into
// them with a snake_case naming policy (ForecastService.MlJson) and the API
// serializes them to the browser in the usual camelCase — no separate Ml*
// mirror classes needed.

public class ModelMetricsDto
{
    // Null when the metric couldn't be computed (e.g. R² of a holdout whose
    // values are all identical).
    public double? Mae  { get; set; }
    public double? Rmse { get; set; }
    public double? R2   { get; set; }
    public int     N    { get; set; }
}

public class ModelMetricsSetDto
{
    public ModelMetricsDto RandomForest { get; set; } = new();
    public ModelMetricsDto Xgboost      { get; set; } = new();
    public ModelMetricsDto Ensemble     { get; set; } = new();
}

public class SkippedEvaluationDto
{
    public int    ProjectId { get; set; }
    public string Reason    { get; set; } = string.Empty;
}

// The active trained model's manifest (see ml-service model_registry.py).
public class ModelManifestDto
{
    public string    Version      { get; set; } = string.Empty;
    public DateTime? TrainedAt    { get; set; }
    public int       SampleCount  { get; set; }
    public int       ProjectCount { get; set; }
    // Random 80/20 row holdout, per model and for the ensemble.
    public ModelMetricsSetDto Metrics { get; set; } = new();
    // Whole-project holdout (leave-one-project-out), pooled — the stricter
    // check, and the R² the confidence rating uses.
    public ModelMetricsDto? ProjectHoldout { get; set; }
    public int    EvaluatedProjects { get; set; }
    public List<SkippedEvaluationDto> SkippedEvaluations { get; set; } = [];
    public string Confidence { get; set; } = string.Empty; // "Normal" | "Low"
    public List<string> ConfidenceReasons { get; set; } = [];
    public string Storage { get; set; } = string.Empty;    // "r2" | "local"
}

public class ModelAvailabilityDto
{
    public bool    Trained { get; set; }
    // Why not, when Trained is false.
    public string? Message { get; set; }
    public ModelManifestDto? Manifest { get; set; }
}

// The latest background training run (one at a time).
public class TrainingJobDto
{
    public string?   JobId      { get; set; }
    public string    Status     { get; set; } = "idle"; // idle | running | succeeded | failed
    public DateTime? StartedAt  { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string?   Error      { get; set; }
}

// GET /api/forecast/model-status.
public class ModelStatusDto
{
    // False when the ML service itself couldn't be reached — then nothing
    // else here is known.
    public bool   ServiceReachable { get; set; } = true;
    public ModelAvailabilityDto Model    { get; set; } = new();
    public TrainingJobDto       Training { get; set; } = new();
}

public class ProjectTrainingEligibilityDto
{
    public int     ProjectId        { get; set; }
    public string  ProjectName      { get; set; } = string.Empty;
    public int     BoqRows          { get; set; }
    public int     RowsWithPoLines  { get; set; }
    public int     EligibleRows     { get; set; }
    public bool    Eligible         { get; set; }
    // Why the project (or some of its rows) can't be used; null when fully eligible.
    public string? Reason           { get; set; }
}

// GET /api/forecast/training-data.
public class TrainingDataReportDto
{
    public int  CompletedProjects { get; set; }
    public int  EligibleProjects  { get; set; }
    public int  EligibleRows      { get; set; }
    public int  ExcludedProjects  { get; set; }
    public int  MinRows           { get; set; }
    public int  MinProjects       { get; set; }
    public bool CanTrain          { get; set; }
    public List<ProjectTrainingEligibilityDto> Projects { get; set; } = [];
}

// Wire-only: the ML service's model-status payload also carries the finished
// run's leave-one-project-out evaluations, which the backend persists (see
// ForecastService.PersistEvaluationsAsync) but never forwards to the browser.
public class MlModelStatusDto
{
    public ModelAvailabilityDto Model    { get; set; } = new();
    public MlTrainingJobDto     Training { get; set; } = new();
}

public class MlTrainingJobDto : TrainingJobDto
{
    public MlTrainingResultDto? Result { get; set; }
}

public class MlTrainingResultDto
{
    public ModelManifestDto Model { get; set; } = new();
    public List<MlProjectEvaluationDto> Evaluations { get; set; } = [];
}

// One historical project's leave-one-project-out evaluation forecast — see
// training_service.py's _leave_one_project_out.
public class MlProjectEvaluationDto
{
    [JsonPropertyName("project_id")]           public int     ProjectId { get; set; }
    [JsonPropertyName("forecasted_materials")] public List<MlForecastedMaterialDto> ForecastedMaterials { get; set; } = [];
}
