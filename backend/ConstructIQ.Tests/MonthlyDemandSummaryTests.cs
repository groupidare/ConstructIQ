using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Xunit;

namespace ConstructIQ.Tests;

[Collection("Database")]
public class MonthlyDemandSummaryTests(DatabaseFixture fixture)
{
    [Fact] // A completed project is attributed to the month it reached 100%, not the month its records were logged.
    public async Task Attribution_UsesCompletionMonth_NotRecordedMonth()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, startDate: new DateTime(2026, 7, 1), status: ProjectStatus.Completed);
        await TestDataBuilder.CreateProgressUpdateAsync(db, project.Id, user.Id, 100, new DateTime(2026, 11, 20));
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 20, isReusable: true,
            recordedAt: new DateTime(2026, 9, 15));

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal("2026-11", summary[0].Month);
    }

    [Fact] // A backfilled project (no 100% progress update) falls back to its TargetEndDate.
    public async Task BackfilledProject_UsesTargetEndDate()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed, isHistorical: true,
            startDate: new DateTime(2024, 1, 10), targetEndDate: new DateTime(2024, 8, 31));
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100, actualQuantity: 95);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal("2024-08", summary[0].Month);
        Assert.Equal(95, summary[0].ActualUsage); // typed Actual Qty, no records needed
    }

    [Fact] // Active projects never appear, even with Excess/Waste already logged.
    public async Task ActiveProject_IsExcluded()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Active);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Empty(summary);
    }

    [Fact] // Excess and waste recorded in different months still land as ONE figure, in the completion month.
    public async Task SpanningMonths_AttributesFullUsageToCompletionMonthOnly()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, startDate: new DateTime(2026, 1, 1), status: ProjectStatus.Completed);
        await TestDataBuilder.CreateProgressUpdateAsync(db, project.Id, user.Id, 100, new DateTime(2026, 6, 5));
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true,
            recordedAt: new DateTime(2026, 3, 1));
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 5, isReusable: false,
            recordedAt: new DateTime(2026, 5, 1));

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();

        Assert.Single(summary);
        Assert.Equal("2026-06", summary[0].Month);
        Assert.Equal(85, summary[0].ActualUsage); // 100 - 10 - 5, the full combined figure
    }

    [Fact] // A line with no record uses its ActualQuantity; one still at 0 is "no data" and skipped.
    public async Task LinesWithoutRecords_UseActualQuantity_AndSkipZero()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100, actualQuantity: 100);
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 50, actualQuantity: 0);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(100, summary[0].ActualUsage);
        Assert.Equal(100, summary[0].EstimatedTotal); // the skipped 50 line doesn't count anywhere
    }

    [Fact] // A BOQItem whose EstimatedPurchaseUnit differs from Unit still charts —
    // the record was logged against EstimatedPurchaseQuantity (the picker's own baseline
    // whenever it's set), so that's the figure used, never the separate, non-convertible
    // EstimatedQuantity/Unit pair, and never excluded as if the data were bad.
    public async Task PurchaseUnitDiffersFromEstimateUnit_UsesPurchaseQuantityAsBaseline()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "sq.m");
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id,
            estimatedQuantity: 100, unit: "sq.m", estimatedPurchaseQuantity: 40, estimatedPurchaseUnit: "bag");
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 5, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, "bag")).ToList();
        Assert.Single(summary);
        Assert.Equal(35, summary[0].ActualUsage); // 40 (EstimatedPurchaseQuantity) - 5, never against the 100 sq.m estimate
        Assert.Equal("bag", summary[0].Unit);

        var flagged = (await boqService.GetFlaggedExcessItemsAsync(user.Id, "Admin")).ToList();
        Assert.DoesNotContain(flagged, f => f.BOQItemId == boq.Id);
    }

    [Fact] // A forecast made before completion lands in the completion month next to its actual; one made after is ignored.
    public async Task Prediction_OnlyFromRunsBeforeCompletion_InCompletionMonth()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, startDate: new DateTime(2026, 1, 1), status: ProjectStatus.Completed);
        await TestDataBuilder.CreateProgressUpdateAsync(db, project.Id, user.Id, 100, new DateTime(2026, 6, 20));
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true,
            recordedAt: new DateTime(2026, 4, 10));
        var before = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, new DateTime(2026, 2, 1));
        await TestDataBuilder.AddForecastedMaterialAsync(db, before.Id, material.Id, 75);
        var after = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, new DateTime(2026, 7, 1));
        await TestDataBuilder.AddForecastedMaterialAsync(db, after.Id, material.Id, 999);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal("2026-06", summary[0].Month);
        Assert.Equal(90, summary[0].ActualUsage);
        Assert.Equal(75, summary[0].AiPredicted);
    }

    [Fact] // An unrelated active project's forecast never inflates a completed project's AI Predicted figure.
    public async Task Prediction_FromActiveProject_IsNotCounted()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var material = await TestDataBuilder.CreateMaterialAsync(db);

        var done = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed, isHistorical: true,
            startDate: new DateTime(2026, 1, 1), targetEndDate: new DateTime(2026, 10, 1));
        await TestDataBuilder.CreateBoqItemAsync(db, done.Id, material.Id, user.Id, estimatedQuantity: 100, actualQuantity: 100);

        var active = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Active);
        var activeRun = await TestDataBuilder.CreateForecastResultAsync(db, active.Id, new DateTime(2026, 9, 15));
        await TestDataBuilder.AddForecastedMaterialAsync(db, activeRun.Id, material.Id, 1938);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(100, summary[0].ActualUsage);
        Assert.Null(summary[0].AiPredicted);
        Assert.Equal(1, summary[0].ProjectCount);
    }

    [Fact] // A material with actual usage but no forecast run shows AiPredicted as null, never zero.
    public async Task MissingPrediction_RendersAsNullNotZero()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Null(summary[0].AiPredicted);
    }
}
