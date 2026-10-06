using System.Text.Json;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Forecast;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ConstructIQ.Tests;

// The trained-model workflow's database side: a training run's
// leave-one-project-out evaluations are saved once per model version and
// replace the previous model's, and the fallback-forecast cleanup removes
// only forecasts no trained model produced. (The HTTP calls to the ML service
// aren't exercised here — PersistEvaluationsAsync is the part that writes.)
[Collection("Database")]
public class ForecastTrainingWorkflowTests(DatabaseFixture fixture)
{
    private static ForecastService NewService(AppDbContext db) =>
        new(db, null!, NullLogger<ForecastService>.Instance);

    private static MlProjectEvaluationDto Evaluation(int projectId, int materialId, decimal quantity) => new()
    {
        ProjectId = projectId,
        ForecastedMaterials =
        [
            new MlForecastedMaterialDto { MaterialId = materialId, Unit = "pcs", ForecastedQuantity = quantity, RiskLevel = "Low" },
        ],
    };

    [Fact] // Saved once per version; a new version replaces the previous model's evaluations.
    public async Task PersistEvaluations_IdempotentPerVersion_NewVersionReplacesOld()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed, isHistorical: true);
        var material = await TestDataBuilder.CreateMaterialAsync(db, "pcs");
        var service = NewService(db);

        await service.PersistEvaluationsAsync("v1", [Evaluation(project.Id, material.Id, 2000)]);
        await service.PersistEvaluationsAsync("v1", [Evaluation(project.Id, material.Id, 2000)]); // a second poll of the same run

        var v1 = await db.ForecastResults.Where(f => f.ProjectId == project.Id).ToListAsync();
        var run = Assert.Single(v1);
        Assert.StartsWith($"{ForecastService.EvaluationNotesPrefix}v1", run.Notes);
        Assert.StartsWith(ForecastService.LeaveOneProjectOutMarker, run.Notes); // still what the chart keys on

        await service.PersistEvaluationsAsync("v2", [Evaluation(project.Id, material.Id, 2300)]);

        await using var check = fixture.CreateContext();
        var after = await check.ForecastResults.Include(f => f.ForecastedMaterials)
            .Where(f => f.ProjectId == project.Id).ToListAsync();
        var current = Assert.Single(after);
        Assert.StartsWith($"{ForecastService.EvaluationNotesPrefix}v2", current.Notes);
        Assert.Equal(2300, Assert.Single(current.ForecastedMaterials).ForecastedQuantity);
    }

    [Fact] // Cleanup is a dry run without --confirm; with it, only forecasts no trained model made are removed.
    public async Task CleanupFallbackForecasts_DryRunThenRemovesOnlyUnstampedRuns()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, "pcs");

        var fallback = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, DateTime.UtcNow.AddDays(-2));
        await TestDataBuilder.AddForecastedMaterialAsync(db, fallback.Id, material.Id, 130);
        var legacyEvaluation = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, DateTime.UtcNow.AddDays(-2),
            notes: $"{ForecastService.LeaveOneProjectOutMarker} — predicted by a model trained without this project's own rows.");
        var trained = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, DateTime.UtcNow,
            notes: $"{ForecastService.AiForecastNotesPrefix}20261006T120000000000Z");
        await TestDataBuilder.AddForecastedMaterialAsync(db, trained.Id, material.Id, 2300);
        var evaluation = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, DateTime.UtcNow,
            notes: $"{ForecastService.EvaluationNotesPrefix}20261006T120000000000Z: predicted by a model trained without this project's own rows.");

        await DbInitializer.CleanupFallbackForecastsAsync(db, confirm: false);
        await using (var afterDryRun = fixture.CreateContext())
            Assert.Equal(4, await afterDryRun.ForecastResults.CountAsync(f => f.ProjectId == project.Id));

        await DbInitializer.CleanupFallbackForecastsAsync(db, confirm: true);
        await using var check = fixture.CreateContext();
        var remaining = await check.ForecastResults.Where(f => f.ProjectId == project.Id).Select(f => f.Id).ToListAsync();
        Assert.Equal(new[] { trained.Id, evaluation.Id }.OrderBy(i => i), remaining.OrderBy(i => i));
        Assert.False(await check.ForecastedMaterials.AnyAsync(fm => fm.ForecastResultId == fallback.Id));
        Assert.DoesNotContain(legacyEvaluation.Id, remaining);
    }
}

// The ML service's training endpoints answer in snake_case; the shared DTOs
// are read with ForecastService.MlJson. No database.
public class MlTrainingJsonTests
{
    [Fact]
    public void ModelStatus_SnakeCase_MapsOntoDtos()
    {
        const string json = """
        {
          "model": {
            "trained": true, "message": null,
            "manifest": {
              "version": "20261006T120000000000Z", "trained_at": "2026-10-06T12:00:00.123456+00:00",
              "sample_count": 1248, "project_count": 14,
              "metrics": { "random_forest": {"mae": 12.5, "rmse": 20.1, "r2": 0.81, "n": 250},
                           "xgboost": {"mae": 11.0, "rmse": 19.0, "r2": null, "n": 250},
                           "ensemble": {"mae": 10.9, "rmse": 18.7, "r2": 0.84, "n": 250} },
              "project_holdout": {"mae": 15.2, "rmse": 25.0, "r2": 0.72, "n": 1248},
              "evaluated_projects": 13,
              "skipped_evaluations": [ {"project_id": 7, "reason": "Only 3 training row(s) from other projects (need 10)."} ],
              "confidence": "Low", "confidence_reasons": ["Trained on only 4 project(s) (fewer than 5)."],
              "storage": "r2", "feature_cols": ["boq_quantity"], "artifacts": ["rf_model.pkl"]
            }
          },
          "training": {
            "job_id": "abc", "status": "succeeded",
            "started_at": "2026-10-06T11:58:00+00:00", "finished_at": "2026-10-06T12:00:01+00:00", "error": null,
            "result": { "model": { "version": "20261006T120000000000Z" },
                        "evaluations": [ { "project_id": 3, "forecasted_materials": [
                          { "material_id": 9, "material_name": "CHB", "unit": "pcs", "forecasted_quantity": 2300,
                            "current_stock": 0, "shortage": 2300, "reorder_suggestion": 2530, "risk_level": "Critical" } ] } ] }
          }
        }
        """;

        var status = JsonSerializer.Deserialize<MlModelStatusDto>(json, ForecastService.MlJson)!;

        Assert.True(status.Model.Trained);
        var m = status.Model.Manifest!;
        Assert.Equal(1248, m.SampleCount);
        Assert.Equal(14, m.ProjectCount);
        Assert.Equal(0.84, m.Metrics.Ensemble.R2);
        Assert.Null(m.Metrics.Xgboost.R2);
        Assert.Equal(0.72, m.ProjectHoldout!.R2);
        Assert.Equal("Low", m.Confidence);
        Assert.Equal(7, Assert.Single(m.SkippedEvaluations).ProjectId);
        Assert.NotNull(m.TrainedAt);

        Assert.Equal("succeeded", status.Training.Status);
        var evaluation = Assert.Single(status.Training.Result!.Evaluations);
        Assert.Equal(3, evaluation.ProjectId);
        Assert.Equal(2300, Assert.Single(evaluation.ForecastedMaterials).ForecastedQuantity);
        Assert.Equal("pcs", evaluation.ForecastedMaterials[0].Unit);
    }

    [Fact]
    public void TrainingDataReport_SnakeCase_MapsOntoDto()
    {
        const string json = """
        { "completed_projects": 67, "eligible_projects": 14, "eligible_rows": 1248, "excluded_projects": 53,
          "min_rows": 10, "min_projects": 2, "can_train": true,
          "projects": [ { "project_id": 1, "project_name": "A", "boq_rows": 20, "rows_with_po_lines": 0,
                          "eligible_rows": 0, "eligible": false, "reason": "No PO-report lines." } ] }
        """;

        var report = JsonSerializer.Deserialize<TrainingDataReportDto>(json, ForecastService.MlJson)!;

        Assert.Equal(67, report.CompletedProjects);
        Assert.Equal(53, report.ExcludedProjects);
        Assert.True(report.CanTrain);
        var p = Assert.Single(report.Projects);
        Assert.Equal(20, p.BoqRows);
        Assert.Equal(0, p.RowsWithPoLines);
        Assert.Equal("No PO-report lines.", p.Reason);
    }
}
