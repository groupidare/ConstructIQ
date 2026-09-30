using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Xunit;

namespace ConstructIQ.Tests;

[Collection("Database")]
public class MonthlyDemandSummaryTests(DatabaseFixture fixture)
{
    [Fact] // Case 11: a July-started project reconciled in September is attributed to September, not July.
    public async Task Attribution_UsesRecordedMonth_NotProjectStartDate()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, startDate: new DateTime(2026, 7, 1));
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 20, isReusable: true,
            recordedAt: new DateTime(2026, 9, 15));

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal("2026-09", summary[0].Month);
    }

    [Fact] // Case 12: excess and waste recorded in different months attribute to ONE reporting month
    // (the latest record), with the FULL combined usage — never split/double-plotted across both months.
    public async Task SpanningMonths_AttributesFullUsageToLatestMonthOnly()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, startDate: new DateTime(2026, 1, 1));
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true,
            recordedAt: new DateTime(2026, 3, 1));
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 5, isReusable: false,
            recordedAt: new DateTime(2026, 5, 1));

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();

        Assert.Single(summary); // one bucket, not two
        Assert.Equal("2026-05", summary[0].Month); // the later record's month
        Assert.Equal(85, summary[0].ActualUsage); // 100 - 10 - 5, the full combined figure
    }

    [Fact] // Case 13: a BOQItem whose EstimatedPurchaseUnit differs from Unit is excluded, and flagged, not guessed.
    public async Task IncompatibleUnits_AreExcludedAndFlagged()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "sq.m");
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id,
            estimatedQuantity: 100, unit: "sq.m", estimatedPurchaseQuantity: 40, estimatedPurchaseUnit: "bag");
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 5, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Empty(summary);

        var flagged = (await boqService.GetFlaggedExcessItemsAsync(user.Id, "Admin")).ToList();
        Assert.Contains(flagged, f => f.BOQItemId == boq.Id);
    }

    [Fact] // Case 14: a material with both a reconciled actual usage and a forecast run in the same month shows both.
    public async Task MatchingActualAndPredicted_BothPopulateSameMonth()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true,
            recordedAt: new DateTime(2026, 6, 10));
        var forecast = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, new DateTime(2026, 6, 1));
        await TestDataBuilder.AddForecastedMaterialAsync(db, forecast.Id, material.Id, 75);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(90, summary[0].ActualUsage);
        Assert.Equal(75, summary[0].AiPredicted);
    }

    [Fact] // Case 15: a material with actual usage but no forecast run shows AiPredicted as null, never zero.
    public async Task MissingPrediction_RendersAsNullNotZero()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Null(summary[0].AiPredicted);
    }

    [Fact] // Case 16: an Active (not Completed/historical) project's result is tagged Provisional.
    public async Task ActiveProject_IsTaggedProvisional()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Active);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Equal("Provisional", summary[0].ReconciliationStatus);
    }

    [Fact] // Case 16 (converse): a Completed project's result is tagged Finalized.
    public async Task CompletedProject_IsTaggedFinalized()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, user.Id, 10, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Equal("Finalized", summary[0].ReconciliationStatus);
    }
}
