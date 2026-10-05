using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Xunit;

namespace ConstructIQ.Tests;

// Demand forecasting in purchase units: historical rows take their purchase
// quantity/unit from their own PO lines, delivered baselines never cross
// projects, and the Forecasting chart pairs Actual Usage and AI Predicted
// on the same purchase-unit series.
[Collection("Database")]
public class PurchaseUnitForecastingTests(DatabaseFixture fixture)
{
    private static BOQItemUpsertDto HistoricalRow(int materialId, decimal? actual, List<HistoricalSupplyLineDto>? supply,
        decimal? clientPurchaseQuantity = null, string? clientPurchaseUnit = null, int? id = null) => new()
    {
        Id = id, MaterialId = materialId, PrimarySection = "Architectural Works", SubCategory = "Exterior Wall",
        Specification = "Concrete Hollow Block 150mm", Unit = "sq.m", EstimatedQuantity = 130,
        ActualQuantity = actual, HistoricalSupply = supply,
        EstimatedPurchaseQuantity = clientPurchaseQuantity, EstimatedPurchaseUnit = clientPurchaseUnit,
    };

    private static HistoricalSupplyLineDto Po(string unit, decimal quantity) =>
        new() { PoNumber = "PO-1", MaterialName = "CHB 150mm", Unit = unit, Quantity = quantity };

    private static async Task<(User User, Project Project, Material Material)> SeedHistoricalProjectAsync(AppDbContext db)
    {
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Completed, isHistorical: true,
            startDate: new DateTime(2024, 1, 10), targetEndDate: new DateTime(2024, 8, 31));
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        return (user, project, material);
    }

    [Fact] // PO lines all in one unit (pc/pcs folded) → their sum/unit become the row's purchase quantity/unit.
    public async Task HistoricalSave_SingleUnitPoLines_SetPurchaseQuantityAndUnit()
    {
        await using var db = fixture.CreateContext();
        var (user, project, material) = await SeedHistoricalProjectAsync(db);
        var service = new BOQService(db);

        var saved = (await service.BulkSaveAsync(project.Id,
            [HistoricalRow(material.Id, actual: null, [Po("pcs", 2000), Po("PC", 368)])], user.Id)).Single();

        Assert.Equal(2368, saved.EstimatedPurchaseQuantity);
        Assert.Equal("pcs", saved.EstimatedPurchaseUnit);
        Assert.Equal(130, saved.EstimatedQuantity);   // BOQ measure untouched
        Assert.Equal("sq.m", saved.Unit);
    }

    [Fact] // Mixed-unit PO lines can't be summed → both stay null, whatever the client sent.
    public async Task HistoricalSave_MixedUnitPoLines_LeaveBothNull()
    {
        await using var db = fixture.CreateContext();
        var (user, project, material) = await SeedHistoricalProjectAsync(db);
        var service = new BOQService(db);

        var saved = (await service.BulkSaveAsync(project.Id,
            [HistoricalRow(material.Id, actual: null, [Po("pcs", 2000), Po("bag", 5)], clientPurchaseQuantity: 50, clientPurchaseUnit: "bag")],
            user.Id)).Single();

        Assert.Null(saved.EstimatedPurchaseQuantity);
        Assert.Null(saved.EstimatedPurchaseUnit);
    }

    [Fact] // No PO lines → both null; the row stays in its BOQ unit.
    public async Task HistoricalSave_NoPoLines_LeaveBothNull()
    {
        await using var db = fixture.CreateContext();
        var (user, project, material) = await SeedHistoricalProjectAsync(db);
        var service = new BOQService(db);

        var withEmptyList = (await service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, actual: null, [])], user.Id)).Single();
        var withoutList = (await service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, actual: null, null)], user.Id)).Single();

        Assert.Null(withEmptyList.EstimatedPurchaseQuantity);
        Assert.Null(withEmptyList.EstimatedPurchaseUnit);
        Assert.Null(withoutList.EstimatedPurchaseQuantity);
        Assert.Null(withoutList.EstimatedPurchaseUnit);
    }

    [Fact] // A re-save that doesn't carry the PO lines keeps the purchase quantity from the lines already on file.
    public async Task HistoricalResave_WithoutSupplyLines_KeepsPurchaseFromStoredLines()
    {
        await using var db = fixture.CreateContext();
        var (user, project, material) = await SeedHistoricalProjectAsync(db);
        var service = new BOQService(db);

        var first = (await service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, null, [Po("pcs", 2368)])], user.Id)).Single();
        var resaved = (await service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, 2160, null, id: first.Id)], user.Id)).Single();

        Assert.Equal(2368, resaved.EstimatedPurchaseQuantity);
        Assert.Equal("pcs", resaved.EstimatedPurchaseUnit);
        Assert.Equal(2160, resaved.ActualQuantity);
    }

    [Fact] // The 3x implausible-Actual check compares against the PO quantity (pcs), not the BOQ area (sq.m).
    public async Task HistoricalSave_ImplausibleCheck_UsesPoQuantity()
    {
        await using var db = fixture.CreateContext();
        var (user, project, material) = await SeedHistoricalProjectAsync(db);
        var service = new BOQService(db);

        // 2,160 pcs is > 3 x 130 sq.m, but well within 3 x 2,368 pcs — accepted.
        var saved = (await service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, 2160, [Po("pcs", 2368)])], user.Id)).Single();
        Assert.Equal(2160, saved.ActualQuantity);

        // 8,000 pcs is > 3 x 2,368 pcs — rejected.
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, 8000, [Po("pcs", 2368)])], user.Id));
    }

    [Fact] // Another project's unlinked Delivered PO line for the same material never counts toward this project's baseline.
    public async Task DeliveredBaseline_IgnoresOtherProjectsDeliveries()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Active);
        var other = await TestDataBuilder.CreateProjectAsync(db, user.Id, status: ProjectStatus.Active);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        var otherBoq = await TestDataBuilder.CreateBoqItemAsync(db, other.Id, material.Id, user.Id, estimatedQuantity: 1000);
        // Unlinked (Material/Phase fallback) and wrongly-linked (direct BOQItemId) deliveries on the OTHER project.
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, other.Id, user.Id, material.Id, 999);
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, other.Id, user.Id, material.Id, 500, boqItemId: boq.Id);

        // ExcessWasteService: baseline stays this line's own 100 — 150 of excess exceeds it.
        var excess = new ExcessWasteService(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() => excess.CreateAsync(new ExcessWasteCreateDto
        {
            ProjectId = project.Id, MaterialId = material.Id, BOQItemId = boq.Id,
            ExcessType = "Overordered", Quantity = 150, UnitCost = 5, IsReusable = true,
        }, user.Id));

        // BOQService: a project completed through the app shows its own delivered baseline as Material Quantity.
        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
        await TestDataBuilder.CompleteProjectAsync(db, other.Id);
        var rows = (await new BOQService(db).GetByProjectAsync(project.Id)).ToList();
        Assert.Equal(100, Assert.Single(rows).MaterialQuantity);

        // The other project's own unlinked delivery still counts for the other project.
        var otherRows = (await new BOQService(db).GetByProjectAsync(other.Id)).ToList();
        Assert.Equal(999, Assert.Single(otherRows, r => r.Id == otherBoq.Id).MaterialQuantity);
    }

    [Theory] // A historical row's Actual (pcs) and its forecast (pcs, or unitless) chart on ONE purchase-unit series.
    [InlineData("pcs")]
    [InlineData("PC")]
    [InlineData("")] // unitless forecast row → takes the BOQ line's purchase unit
    public async Task Chart_HistoricalRow_ActualAndForecastPairInPurchaseUnit(string forecastUnit)
    {
        await using var db = fixture.CreateContext();
        var (user, project, material) = await SeedHistoricalProjectAsync(db);
        var service = new BOQService(db);
        await service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, 2160, [Po("pcs", 2368)])], user.Id);

        var run = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, new DateTime(2026, 10, 1));
        await TestDataBuilder.AddForecastedMaterialAsync(db, run.Id, material.Id, 2200, unit: forecastUnit);

        var summary = (await service.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        var point = Assert.Single(summary);
        Assert.Equal("2024-08", point.Month);
        Assert.Equal("pcs", point.Unit);
        Assert.Equal(2160, point.ActualUsage);
        Assert.Equal(2200, point.AiPredicted);
        Assert.Equal(2368, point.EstimatedTotal);   // PO quantity is the baseline, not 130 sq.m
    }

    [Fact] // A backfilled project's leave-one-project-out evaluation beats every ordinary forecast run on it.
    public async Task Chart_HistoricalProject_PrefersLeaveOneProjectOutEvaluation()
    {
        await using var db = fixture.CreateContext();
        var (user, project, material) = await SeedHistoricalProjectAsync(db);
        var service = new BOQService(db);
        await service.BulkSaveAsync(project.Id, [HistoricalRow(material.Id, 2160, [Po("pcs", 2368)])], user.Id);

        var evaluation = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, new DateTime(2026, 9, 1),
            notes: $"{ForecastService.LeaveOneProjectOutMarker} — predicted by a model trained without this project's own rows.");
        await TestDataBuilder.AddForecastedMaterialAsync(db, evaluation.Id, material.Id, 2050, unit: "pcs");
        // A later ordinary run (from a model that trained on this project's own actuals) is ignored.
        var ordinary = await TestDataBuilder.CreateForecastResultAsync(db, project.Id, new DateTime(2026, 10, 1));
        await TestDataBuilder.AddForecastedMaterialAsync(db, ordinary.Id, material.Id, 2160, unit: "pcs");

        var point = Assert.Single(await service.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null));
        Assert.Equal(2050, point.AiPredicted);
    }
}
