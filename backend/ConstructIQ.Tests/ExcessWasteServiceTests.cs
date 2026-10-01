using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Xunit;

namespace ConstructIQ.Tests;

[Collection("Database")]
public class ExcessWasteServiceTests(DatabaseFixture fixture)
{
    private static ExcessWasteCreateDto Dto(int projectId, int? materialId, int? boqItemId, decimal quantity, bool isReusable) => new()
    {
        ProjectId = projectId, MaterialId = materialId, BOQItemId = boqItemId,
        ExcessType = isReusable ? "Overordered" : "Damaged",
        Quantity = quantity, UnitCost = 5, IsReusable = isReusable,
    };

    [Fact] // Case 2: excess-only deduction in an otherwise-reconciled item.
    public async Task ExcessOnly_ProducesCorrectActualUsage()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 200);

        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 30, isReusable: true), user.Id);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(170, summary[0].ActualUsage);
        Assert.Equal(30, summary[0].ExcessTotal);
        Assert.Equal(0, summary[0].WasteTotal);
    }

    [Fact] // Case 2: waste-only deduction.
    public async Task WasteOnly_ProducesCorrectActualUsage()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 200);

        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 15, isReusable: false), user.Id);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(185, summary[0].ActualUsage);
        Assert.Equal(0, summary[0].ExcessTotal);
        Assert.Equal(15, summary[0].WasteTotal);
    }

    [Fact] // Case 4: a BOQItem with zero records is omitted entirely, never shown as zero usage.
    public async Task UnreconciledBoqItem_IsOmittedFromSummary()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 200);
        // No ExcessWasteRecord created at all.

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Empty(summary);
    }

    [Fact] // Case 6 (service level): a new entry that would exceed the estimate is rejected, not clamped.
    public async Task CreateAsync_ExceedingBaseline_ThrowsInsteadOfClamping()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 50);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 60, isReusable: true), user.Id));
    }

    [Fact] // Case 8: multiple records sum once, never double-deducted or re-baselined.
    public async Task MultipleRecords_SumWithoutDuplicateDeduction()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);

        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 10, isReusable: true), user.Id);
        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 10, isReusable: true), user.Id);
        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 10, isReusable: true), user.Id);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(70, summary[0].ActualUsage); // 100 - 30, not 100 - 30*3
        Assert.Equal(30, summary[0].ExcessTotal);
    }

    [Fact] // Case 9: recording Excess must not block also recording Waste for the same BOQ item.
    public async Task BothExcessAndWaste_CanBeRecordedForSameItem()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);

        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 10, isReusable: true), user.Id);

        // The pending-items picker must still offer this item for Waste...
        var pendingForWaste = (await service.GetPendingBOQItemsAsync(project.Id, isReusable: false)).ToList();
        Assert.Contains(pendingForWaste, p => p.BOQItemId == boq.Id);
        // ...but no longer for Excess (already logged as Excess).
        var pendingForExcess = (await service.GetPendingBOQItemsAsync(project.Id, isReusable: true)).ToList();
        Assert.DoesNotContain(pendingForExcess, p => p.BOQItemId == boq.Id);

        // And the second (Waste) entry actually succeeds.
        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 5, isReusable: false), user.Id);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Equal(85, summary[0].ActualUsage); // 100 - 10 - 5
    }

    [Fact] // Case 10: two separate BOQ rows for the same material stay independent.
    public async Task SeparateBoqRowsSameMaterial_StayIndependent()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boqA = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);
        var boqB = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 50);

        await service.CreateAsync(Dto(project.Id, material.Id, boqA.Id, 10, isReusable: true), user.Id);
        await service.CreateAsync(Dto(project.Id, material.Id, boqB.Id, 5, isReusable: true), user.Id);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary); // same material+unit+month, aggregated into one chart point
        Assert.Equal(135, summary[0].ActualUsage); // (100-10) + (50-5)
        Assert.Single(summary[0].ContributingProjects); // same project for both rows — listed once, not twice
    }

    [Fact] // Case 17: a legacy record with no BOQItemId link is excluded, never matched by material name.
    public async Task RecordWithNoBoqItemLink_IsExcludedFromSummary()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);

        // Simulates a legacy free-text entry: no BOQItemId, even though a
        // same-material BOQ row exists — must not be matched by name.
        db.ExcessWasteRecords.Add(new ExcessWasteRecord
        {
            ProjectId = project.Id, MaterialId = material.Id, BOQItemId = null,
            ExcessType = ExcessType.Overordered, Quantity = 10, UnitCost = 5, TotalCost = 50,
            IsReusable = true, RecordedByUserId = user.Id,
        });
        await db.SaveChangesAsync();

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Empty(summary);
    }
}
