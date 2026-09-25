using System.Net.Http.Json;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Forecast;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ForecastService(AppDbContext db, IHttpClientFactory httpFactory, ILogger<ForecastService> logger) : IForecastService
{
    public async Task<ForecastResponseDto> GenerateForecastAsync(ForecastRequestDto request, int userId)
    {
        var client = httpFactory.CreateClient("MLService");

        var payload = new
        {
            project_id    = request.ProjectId,
            phase_id      = request.PhaseId,
            period        = request.Period,
            planning_weeks= request.PlanningWeeks ?? 4,
        };

        HttpResponseMessage response;
        try
        {
            response = await client.PostAsJsonAsync("/forecast/predict", payload);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Forecast generation failed to reach the ML service for project {ProjectId}.", request.ProjectId);
            throw new InvalidOperationException("Couldn't reach the forecasting service. Make sure it's running and try again.");
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            logger.LogError("Forecast generation failed for project {ProjectId}: {Status} {Body}", request.ProjectId, response.StatusCode, body);
            throw new InvalidOperationException("Couldn't generate a forecast for this project right now. It usually means the model needs to be (re)trained, or this project doesn't have enough BOQ data yet.");
        }

        var mlResult = await response.Content.ReadFromJsonAsync<MlForecastResponseDto>();
        if (mlResult is null)
            throw new InvalidOperationException("The forecasting service returned an empty response.");

        // The ML service is stateless — it computes and returns a result but never
        // persists it. Without saving here, GetByProjectAsync (which is what the
        // project card and a reopened Material Plan both read from) would always
        // see an empty history, even though a forecast was just "successfully" run.
        if (!Enum.TryParse<ForecastPeriod>(request.Period, true, out var period))
            period = ForecastPeriod.Monthly;

        var entity = new ForecastResult
        {
            ProjectId         = request.ProjectId,
            PhaseId           = request.PhaseId,
            Period            = period,
            PlanningWeeks     = request.PlanningWeeks,
            ModelAccuracy     = mlResult.ModelAccuracy,
            GeneratedByUserId = userId,
        };
        foreach (var fm in mlResult.ForecastedMaterials)
        {
            if (!Enum.TryParse<RiskLevel>(fm.RiskLevel, true, out var risk))
                risk = RiskLevel.Low;

            entity.ForecastedMaterials.Add(new ForecastedMaterial
            {
                MaterialId         = fm.MaterialId,
                ForecastedQuantity = fm.ForecastedQuantity,
                CurrentStock       = fm.CurrentStock,
                Shortage           = fm.Shortage,
                ReorderSuggestion  = fm.ReorderSuggestion,
                RiskLevel          = risk,
            });
        }

        db.ForecastResults.Add(entity);
        await db.SaveChangesAsync();

        var saved = await db.ForecastResults
            .Include(f => f.ForecastedMaterials).ThenInclude(fm => fm.Material)
            .FirstAsync(f => f.Id == entity.Id);

        return ToDto(saved);
    }

    public async Task<IEnumerable<ForecastResponseDto>> GetByProjectAsync(int projectId)
    {
        var results = await db.ForecastResults
            .Include(f => f.ForecastedMaterials)
                .ThenInclude(fm => fm.Material)
            .Where(f => f.ProjectId == projectId)
            .OrderByDescending(f => f.GeneratedAt)
            .ToListAsync();

        return results.Select(ToDto);
    }

    private static ForecastResponseDto ToDto(ForecastResult f) => new()
    {
        Id            = f.Id,
        ProjectId     = f.ProjectId,
        PhaseId       = f.PhaseId,
        Period        = f.Period.ToString(),
        GeneratedAt   = f.GeneratedAt,
        ModelAccuracy = f.ModelAccuracy,
        ForecastedMaterials = f.ForecastedMaterials.Select(fm => new ForecastedMaterialDto
        {
            MaterialId         = fm.MaterialId,
            MaterialName       = fm.Material.Name,
            Unit               = fm.Material.Unit,
            ForecastedQuantity = fm.ForecastedQuantity,
            CurrentStock       = fm.CurrentStock,
            Shortage           = fm.Shortage,
            ReorderSuggestion  = fm.ReorderSuggestion,
            RiskLevel          = fm.RiskLevel.ToString(),
        }).ToList(),
    };

    public async Task<TrainModelsResponseDto> TrainModelsAsync()
    {
        var client = httpFactory.CreateClient("MLService");
        var response = await client.PostAsync("/forecast/train", null);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            throw new InvalidOperationException($"Training failed: {body}");
        }

        var result = await response.Content.ReadFromJsonAsync<MlTrainModelsResponseDto>();
        if (result is null)
            throw new InvalidOperationException("The training service returned an empty response.");

        return new TrainModelsResponseDto
        {
            SampleCount  = result.SampleCount,
            RandomForest = result.RandomForest,
            Xgboost      = result.Xgboost,
        };
    }

    public async Task<ForecastAccuracyReportDto> GetAccuracyReportAsync(int projectId)
    {
        var project = await db.Projects.FindAsync(projectId);

        var forecasts = await db.ForecastResults
            .Include(f => f.ForecastedMaterials).ThenInclude(fm => fm.Material)
            .Where(f => f.ProjectId == projectId)
            .ToListAsync();

        var boqItems = await db.BOQItems
            .Include(b => b.Material)
            .Where(b => b.ProjectId == projectId && b.ActualQuantity > 0)
            .ToListAsync();

        var comparisons = boqItems.Select(b =>
        {
            var lastForecast = forecasts
                .SelectMany(f => f.ForecastedMaterials)
                .Where(fm => fm.MaterialId == b.MaterialId)
                .OrderByDescending(fm => fm.Id)
                .FirstOrDefault();

            var forecasted = lastForecast?.ForecastedQuantity ?? 0;
            var actual     = b.ActualQuantity;
            var variance   = actual - forecasted;
            var varPct     = actual > 0 ? Math.Abs(variance / actual) * 100 : 0;

            return new ForecastComparisonDto
            {
                MaterialId         = b.MaterialId,
                MaterialName       = b.Material.Name,
                Unit               = b.Material.Unit,
                ForecastedQuantity = forecasted,
                ActualQuantity     = actual,
                Variance           = variance,
                VariancePercent    = varPct,
                AccuracyPercent    = Math.Max(0, 100 - varPct),
            };
        }).ToList();

        var overall = comparisons.Any() ? comparisons.Average(c => c.AccuracyPercent) : 0;
        var mae     = comparisons.Any() ? comparisons.Average(c => Math.Abs(c.Variance)) : 0;
        var rmse    = comparisons.Any()
            ? (decimal)Math.Sqrt((double)comparisons.Average(c => c.Variance * c.Variance))
            : 0;

        return new ForecastAccuracyReportDto
        {
            ProjectId       = projectId,
            ProjectName     = project?.Name ?? string.Empty,
            OverallAccuracy = overall,
            Mae             = mae,
            Rmse            = rmse,
            Comparisons     = comparisons,
        };
    }
}
