using System.Text.Json.Serialization;

namespace ConstructIQ.API.Models.DTOs.Forecast;

public class ForecastRequestDto
{
    public int     ProjectId     { get; set; }
    public int?    PhaseId       { get; set; }
    public string  Period        { get; set; } = "Monthly";
    public int?    PlanningWeeks { get; set; }
}

public class ForecastResponseDto
{
    public int    Id          { get; set; }
    public int    ProjectId   { get; set; }
    public int?   PhaseId     { get; set; }
    public string Period      { get; set; } = string.Empty;
    public DateTime GeneratedAt { get; set; }
    public decimal? ModelAccuracy { get; set; }
    public List<ForecastedMaterialDto> ForecastedMaterials { get; set; } = [];
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

// Mirrors the ML service's /forecast/train response (snake_case wire format).
public class TrainModelsResponseDto
{
    [JsonPropertyName("sample_count")]  public int             SampleCount  { get; set; }
    [JsonPropertyName("random_forest")] public ModelMetricsDto RandomForest { get; set; } = new();
    [JsonPropertyName("xgboost")]       public ModelMetricsDto Xgboost      { get; set; } = new();
}
