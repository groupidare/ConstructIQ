using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Forecast;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ForecastService(AppDbContext db, IHttpClientFactory httpFactory, ILogger<ForecastService> logger) : IForecastService
{
    // Notes prefix marking a ForecastResult as a historical project's
    // leave-one-project-out evaluation (predicted by a model fitted WITHOUT
    // that project's own rows — see PersistEvaluationsAsync), not an
    // ordinary Generate Forecast run. Matched with StartsWith: the Notes carry
    // the model version after it. BOQService's Forecasting chart prefers
    // these for backfilled projects.
    public const string LeaveOneProjectOutMarker = "Leave-one-project-out evaluation";

    // Every ForecastResult a trained model produced carries the model version
    // in its Notes, starting with one of these — Generate Forecast runs with
    // AiForecastNotesPrefix, evaluations with EvaluationNotesPrefix. Anything
    // without one predates the trained-model workflow (an untrained fallback
    // or a legacy model) — see DbInitializer.CleanupFallbackForecastsAsync.
    public const string AiForecastNotesPrefix = "AI forecast — model ";
    public static readonly string EvaluationNotesPrefix = $"{LeaveOneProjectOutMarker} — model ";

    // The ML service's training endpoints answer in snake_case; the training
    // DTOs are plain PascalCase classes shared with the browser response
    // (camelCase), so they're read with a snake_case policy instead of a
    // second set of [JsonPropertyName]-annotated mirror classes.
    public static readonly JsonSerializerOptions MlJson = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    // A finished training run's evaluations are persisted by whichever
    // model-status poll first sees the run succeeded (see GetModelStatusAsync)
    // — serialized so two concurrent polls can't both write them.
    private static readonly SemaphoreSlim EvaluationPersistLock = new(1, 1);

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

        if (response.StatusCode == HttpStatusCode.Conflict)
        {
            // The ML service refuses to forecast without a trained model
            // (409, code "model_not_trained") rather than answering with an
            // untrained fallback calculation — passed on as its own error so
            // the Material Plan can fall back to the non-AI historical-average
            // estimate instead of showing a generic failure.
            var body = await response.Content.ReadAsStringAsync();
            logger.LogWarning("Forecast blocked for project {ProjectId} — no trained model: {Body}", request.ProjectId, body);
            throw new ModelNotTrainedException(
                "AI forecasting is unavailable until an administrator trains the model (Forecasting → Retrain Model).");
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            logger.LogError("Forecast generation failed for project {ProjectId}: {Status} {Body}", request.ProjectId, response.StatusCode, body);
            throw new InvalidOperationException("Couldn't generate a forecast for this project right now — the forecasting service returned an error. Try again in a moment.");
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
            Notes             = $"{AiForecastNotesPrefix}{mlResult.ModelVersion ?? "unknown"}"
                + (mlResult.ModelConfidence == "Low" ? " (low confidence)" : string.Empty),
        };
        foreach (var fm in mlResult.ForecastedMaterials)
        {
            if (!Enum.TryParse<RiskLevel>(fm.RiskLevel, true, out var risk))
                risk = RiskLevel.Low;

            entity.ForecastedMaterials.Add(new ForecastedMaterial
            {
                MaterialId         = fm.MaterialId,
                Unit               = fm.Unit,
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

        // Per-row predictions are passed straight through (not persisted) —
        // the Material Plan's Run Forecast fills each live row's empty
        // Est. Qty with ITS OWN prediction from these, not its material's
        // total from ForecastedMaterials.
        var dto = ToDto(saved);
        dto.LineForecasts = mlResult.LineForecasts.Select(l => new ForecastedLineDto
        {
            BOQItemId          = l.BOQItemId,
            MaterialId         = l.MaterialId,
            Unit               = l.Unit,
            ForecastedQuantity = l.ForecastedQuantity,
            PurchaseUnitKnown  = l.PurchaseUnitKnown,
        }).ToList();
        return dto;
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
            Unit               = fm.Unit,
            ForecastedQuantity = fm.ForecastedQuantity,
            CurrentStock       = fm.CurrentStock,
            Shortage           = fm.Shortage,
            ReorderSuggestion  = fm.ReorderSuggestion,
            RiskLevel          = fm.RiskLevel.ToString(),
        }).ToList(),
    };

    // Starts a background training run on the ML service and returns at once
    // (a full run can outlast an HTTP request) — the Forecasting page then
    // polls GetModelStatusAsync until it reads succeeded or failed. Only one
    // run at a time: a second start while one runs is refused (409).
    public async Task<TrainingJobDto> StartTrainingAsync()
    {
        var client = httpFactory.CreateClient("MLService");
        HttpResponseMessage response;
        try
        {
            response = await client.PostAsync("/forecast/train", null);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Couldn't reach the ML service to start training.");
            throw new InvalidOperationException("Couldn't reach the forecasting service. Make sure it's running and try again.");
        }

        if (response.StatusCode == HttpStatusCode.Conflict)
            throw new TrainingInProgressException("A training run is already in progress — wait for it to finish.");
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            logger.LogError("Starting training failed: {Status} {Body}", response.StatusCode, body);
            throw new InvalidOperationException("The forecasting service couldn't start a training run.");
        }

        return await response.Content.ReadFromJsonAsync<TrainingJobDto>(MlJson)
            ?? throw new InvalidOperationException("The forecasting service returned an empty response.");
    }

    // The active model (trained or not, with its training metadata) and the
    // latest training run. When that run has just succeeded, its
    // leave-one-project-out evaluations are persisted here — once per model
    // version — since the ML service itself never writes to the database.
    public async Task<ModelStatusDto> GetModelStatusAsync()
    {
        var client = httpFactory.CreateClient("MLService");
        MlModelStatusDto? status;
        try
        {
            status = await client.GetFromJsonAsync<MlModelStatusDto>("/forecast/model-status", MlJson);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Couldn't read the model status from the ML service.");
            return new ModelStatusDto
            {
                ServiceReachable = false,
                Model = new ModelAvailabilityDto { Trained = false, Message = "The forecasting service couldn't be reached." },
            };
        }
        if (status is null)
            return new ModelStatusDto { ServiceReachable = false, Model = new ModelAvailabilityDto { Message = "The forecasting service returned an empty response." } };

        if (status.Training is { Status: "succeeded", Result: { } result } && !string.IsNullOrEmpty(result.Model.Version))
            await PersistEvaluationsAsync(result.Model.Version, result.Evaluations);

        return new ModelStatusDto
        {
            Model = status.Model,
            Training = new TrainingJobDto
            {
                JobId      = status.Training.JobId,
                Status     = status.Training.Status,
                StartedAt  = status.Training.StartedAt,
                FinishedAt = status.Training.FinishedAt,
                Error      = status.Training.Error,
            },
        };
    }

    // Which completed projects/rows training can use, and why the rest can't.
    public async Task<TrainingDataReportDto> GetTrainingDataReportAsync()
    {
        var client = httpFactory.CreateClient("MLService");
        try
        {
            return await client.GetFromJsonAsync<TrainingDataReportDto>("/forecast/training-data", MlJson)
                ?? throw new InvalidOperationException("The forecasting service returned an empty response.");
        }
        catch (Exception ex) when (ex is not InvalidOperationException)
        {
            logger.LogError(ex, "Couldn't read the training-data report from the ML service.");
            throw new InvalidOperationException("Couldn't reach the forecasting service. Make sure it's running and try again.");
        }
    }

    // Saves a newly trained model version's leave-one-project-out evaluations
    // as each historical project's evaluation ForecastResult, replacing EVERY
    // previous evaluation run (they described the previous model, which is no
    // longer the one forecasting). Idempotent per version: the Notes carry
    // the version, so a later status poll for the same run is a no-op.
    public async Task PersistEvaluationsAsync(string version, List<MlProjectEvaluationDto> evaluations)
    {
        var notesPrefix = $"{EvaluationNotesPrefix}{version}";
        await EvaluationPersistLock.WaitAsync();
        try
        {
            var alreadySaved = await db.ForecastResults
                .AnyAsync(f => f.Notes != null && f.Notes.StartsWith(notesPrefix));
            if (alreadySaved) return;

            var previous = await db.ForecastResults
                .Where(f => f.Notes != null && f.Notes.StartsWith(LeaveOneProjectOutMarker))
                .ToListAsync();
            var previousIds = previous.Select(f => f.Id).ToList();
            db.ForecastedMaterials.RemoveRange(await db.ForecastedMaterials
                .Where(fm => previousIds.Contains(fm.ForecastResultId))
                .ToListAsync());
            db.ForecastResults.RemoveRange(previous);

            var projectIds = evaluations.Select(e => e.ProjectId).Distinct().ToList();
            var existingProjectIds = (await db.Projects
                    .Where(p => projectIds.Contains(p.Id))
                    .Select(p => p.Id)
                    .ToListAsync())
                .ToHashSet();

            foreach (var evaluation in evaluations.Where(e => existingProjectIds.Contains(e.ProjectId)))
            {
                var entity = new ForecastResult
                {
                    ProjectId = evaluation.ProjectId,
                    PhaseId   = null,
                    Period    = ForecastPeriod.Monthly,
                    Notes     = $"{notesPrefix}: predicted by a model trained without this project's own rows.",
                };
                foreach (var fm in evaluation.ForecastedMaterials)
                {
                    if (!Enum.TryParse<RiskLevel>(fm.RiskLevel, true, out var risk))
                        risk = RiskLevel.Low;
                    entity.ForecastedMaterials.Add(new ForecastedMaterial
                    {
                        MaterialId         = fm.MaterialId,
                        Unit               = fm.Unit,
                        ForecastedQuantity = fm.ForecastedQuantity,
                        CurrentStock       = fm.CurrentStock,
                        Shortage           = fm.Shortage,
                        ReorderSuggestion  = fm.ReorderSuggestion,
                        RiskLevel          = risk,
                    });
                }
                db.ForecastResults.Add(entity);
            }

            await db.SaveChangesAsync();
        }
        finally
        {
            EvaluationPersistLock.Release();
        }
    }

    // "Top Forecasted Material Demand" panel (System Overview). Uses only
    // saved ForecastedMaterial.ForecastedQuantity values - never a BOQ
    // estimate/historical-average/stock figure. One latest eligible forecast
    // per project (never summed across runs): the latest project-wide
    // (PhaseId == null) forecast if one exists, otherwise the latest single
    // phase forecast, flagged as phase-scoped rather than silently treated
    // as full project coverage. Material identity is grouped by MaterialId
    // alone - safe because Material.Name/Specification/Unit are fixed
    // attributes of the catalog row (never vary per forecast), and this
    // deployment's Materials table has no duplicate Name+Specification+Unit
    // rows under different IDs (checked directly, not assumed) - so two
    // different specs (e.g. 100mm vs 150mm hollow block) always carry
    // different MaterialIds and are never merged. There is no stored forecast
    // target-period interval (no ForecastPeriodStart/End field exists on
    // ForecastResult), so this is presented as a snapshot of latest saved
    // forecasts, not "this month's demand" - see GeneratedAt per contribution.
    //
    // Deliberately company-wide, not role-scoped by project ownership: unlike
    // BOQService's per-project aggregations (which expose individual project
    // figures), this panel only ever surfaces an aggregate top-5 ranking -
    // every authenticated role sees the same company-wide numbers, by design.
    //
    // Default scope is Planning/Active, non-historical projects (the
    // "operational" view). If NONE of those has ever had a forecast
    // generated, this falls back to real, genuine forecast output from
    // historical/completed reference projects rather than permanently
    // showing an empty panel - never a substitute figure, still real saved
    // ForecastedMaterial data, just from a different project set. The
    // fallback is always disclosed via UsedHistoricalFallback, and
    // EligibleProjectCount/ProjectsWithForecastCount/PhaseOnlyProjectCount
    // keep describing the ACTIVE scope honestly even while fallback data is
    // shown - they are never silently swapped for the fallback scope's own
    // numbers, which live separately in HistoricalProjectsWithForecastCount.
    public async Task<TopForecastedDemandDto> GetTopForecastedDemandAsync(string? unit)
    {
        var activeProjects = await db.Projects
            .Where(p => !p.IsHistorical && (p.Status == ProjectStatus.Planning || p.Status == ProjectStatus.Active))
            .Select(p => new ProjectRef(p.Id, p.Name))
            .ToListAsync();

        var result = await BuildTopDemandAsync(activeProjects, unit);
        result.EligibleProjectCount = activeProjects.Count;
        if (result.ProjectsWithForecastCount > 0) return result;

        var historicalProjects = await db.Projects
            .Where(p => p.IsHistorical)
            .Select(p => new ProjectRef(p.Id, p.Name))
            .ToListAsync();
        if (historicalProjects.Count == 0) return result;

        var fallback = await BuildTopDemandAsync(historicalProjects, unit);
        if (fallback.ProjectsWithForecastCount == 0) return result;

        fallback.HistoricalProjectsWithForecastCount = fallback.ProjectsWithForecastCount;
        fallback.EligibleProjectCount = result.EligibleProjectCount;
        fallback.ProjectsWithForecastCount = result.ProjectsWithForecastCount; // 0 - stays honest about the active scope
        fallback.PhaseOnlyProjectCount = result.PhaseOnlyProjectCount;
        fallback.UsedHistoricalFallback = true;
        return fallback;
    }

    private readonly record struct ProjectRef(int Id, string Name);

    // Shared core: given one set of projects (either the active scope or the
    // historical fallback scope), picks the latest eligible forecast per
    // project and builds the ranked-by-unit result. EligibleProjectCount is
    // deliberately left unset here - the caller decides what it means for
    // that particular call (see GetTopForecastedDemandAsync above).
    private async Task<TopForecastedDemandDto> BuildTopDemandAsync(List<ProjectRef> projects, string? unit)
    {
        var result = new TopForecastedDemandDto();
        var ids = projects.Select(p => p.Id).ToHashSet();
        if (ids.Count == 0) return result;

        // One query for every eligible project's forecast history (not one
        // request per project) - avoids N+1 while still letting us pick the
        // true latest per project below.
        var forecasts = await db.ForecastResults
            .Where(f => ids.Contains(f.ProjectId))
            .Include(f => f.ForecastedMaterials).ThenInclude(fm => fm.Material)
            .ToListAsync();

        var projectNames = projects.ToDictionary(p => p.Id, p => p.Name);

        var latestPerProject = new List<(ForecastResult Forecast, bool IsPhaseScoped)>();
        foreach (var group in forecasts.GroupBy(f => f.ProjectId))
        {
            var projectWide = group.Where(f => f.PhaseId == null)
                .OrderByDescending(f => f.GeneratedAt).ThenByDescending(f => f.Id)
                .FirstOrDefault();
            if (projectWide != null) { latestPerProject.Add((projectWide, false)); continue; }

            var phaseLatest = group
                .OrderByDescending(f => f.GeneratedAt).ThenByDescending(f => f.Id)
                .FirstOrDefault();
            if (phaseLatest != null) latestPerProject.Add((phaseLatest, true));
        }

        result.ProjectsWithForecastCount = latestPerProject.Count;
        result.PhaseOnlyProjectCount = latestPerProject.Count(lp => lp.IsPhaseScoped);
        if (latestPerProject.Count == 0) return result;

        var rows = latestPerProject.SelectMany(lp => lp.Forecast.ForecastedMaterials
            .Where(fm => fm.ForecastedQuantity > 0)
            .Select(fm => new
            {
                fm.MaterialId,
                fm.Material.Name,
                fm.Material.Specification,
                RawUnit = fm.Unit,
                NormalizedUnit = NormalizeUnitLabel(fm.Unit),
                fm.ForecastedQuantity,
                ProjectId = lp.Forecast.ProjectId,
                ProjectName = projectNames.GetValueOrDefault(lp.Forecast.ProjectId, string.Empty),
                lp.Forecast.GeneratedAt,
                Period = lp.Forecast.Period.ToString(),
                lp.IsPhaseScoped,
            })).ToList();

        result.AvailableUnits = rows.Select(r => r.NormalizedUnit).Distinct().OrderBy(u => u).ToList();
        if (result.AvailableUnits.Count == 0) return result;

        var requestedUnit = unit is null ? null : NormalizeUnitLabel(unit);
        var selectedUnit = requestedUnit != null && result.AvailableUnits.Contains(requestedUnit)
            ? requestedUnit
            // Deterministic default: unit with the most distinct materials
            // carrying positive demand, tied broken alphabetically.
            : rows.GroupBy(r => r.NormalizedUnit)
                .Select(g => new { Unit = g.Key, MaterialCount = g.Select(r => r.MaterialId).Distinct().Count() })
                .OrderByDescending(g => g.MaterialCount).ThenBy(g => g.Unit)
                .Select(g => g.Unit)
                .First();
        result.SelectedUnit = selectedUnit;

        result.Materials = rows.Where(r => r.NormalizedUnit == selectedUnit)
            .GroupBy(r => r.MaterialId)
            .Select(g => new TopForecastedMaterialDto
            {
                MaterialId = g.Key,
                MaterialName = g.First().Name,
                Specification = g.First().Specification,
                Unit = g.First().RawUnit,
                TotalForecastedQuantity = g.Sum(r => r.ForecastedQuantity),
                ContributingProjectCount = g.Select(r => r.ProjectId).Distinct().Count(),
                Contributions = g.Select(r => new ForecastContributionDto
                {
                    ProjectId = r.ProjectId,
                    ProjectName = r.ProjectName,
                    ForecastedQuantity = r.ForecastedQuantity,
                    GeneratedAt = r.GeneratedAt,
                    Period = r.Period,
                    IsPhaseScoped = r.IsPhaseScoped,
                }).OrderByDescending(c => c.ForecastedQuantity).ToList(),
            })
            .Where(m => m.TotalForecastedQuantity > 0)
            .OrderByDescending(m => m.TotalForecastedQuantity)
            .ThenBy(m => m.MaterialName).ThenBy(m => m.MaterialId)
            .Take(5)
            .ToList();

        for (var i = 0; i < result.Materials.Count; i++) result.Materials[i].Rank = i + 1;

        return result;
    }

    // "pc"/"pcs"/"piece"/"pieces" are the only known equivalent-label variants
    // in this app (PURCHASE_UNITS already canonicalizes on "pc" elsewhere -
    // see BOQService.PurchaseUnits / frontend PURCHASE_UNITS). Everything else
    // is folded only by trim+case, matching topMaterialDemand.ts's existing
    // normalize() convention - never a physical unit conversion.
    private static string NormalizeUnitLabel(string? unit)
    {
        var lower = (unit ?? string.Empty).Trim().ToLowerInvariant();
        return lower switch
        {
            "pcs" or "piece" or "pieces" => "pc",
            _ => lower,
        };
    }

    public async Task<ForecastAccuracyReportDto> GetAccuracyReportAsync(int projectId)
    {
        var project = await db.Projects.FindAsync(projectId);

        var forecasts = await db.ForecastResults
            .Include(f => f.ForecastedMaterials).ThenInclude(fm => fm.Material)
            .Where(f => f.ProjectId == projectId)
            .ToListAsync();

        // IsUsageConfirmed, not just ActualQuantity > 0 — an unconfirmed row's
        // ActualQuantity is just its own estimate standing in (see
        // BOQItem.IsUsageConfirmed), so including it here would partly measure
        // the forecast against its own unrelated estimate rather than real
        // observed usage.
        var boqItems = await db.BOQItems
            .Include(b => b.Material)
            .Where(b => b.ProjectId == projectId && b.IsUsageConfirmed)
            .ToListAsync();

        var comparisons = boqItems.Select(b =>
        {
            // Matched on unit as well as MaterialId — a single forecast run
            // can now carry more than one entry per material (one per
            // distinct unit actually forecasted; see ForecastedMaterial.Unit),
            // so matching by MaterialId alone could pair this BOQ row against
            // a forecast entry made in a different unit for the same material.
            var effectiveUnit = !string.IsNullOrWhiteSpace(b.Unit) ? b.Unit : b.Material.Unit;
            var lastForecast = forecasts
                .SelectMany(f => f.ForecastedMaterials)
                .Where(fm => fm.MaterialId == b.MaterialId
                    && string.Equals(fm.Unit, effectiveUnit, StringComparison.OrdinalIgnoreCase))
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
                Unit               = effectiveUnit,
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
