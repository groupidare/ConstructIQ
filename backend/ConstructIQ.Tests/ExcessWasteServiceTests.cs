using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.EntityFrameworkCore;
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

    [Fact] // Redistributing excess must not make it look like it was never logged.
    public async Task RedistributedExcess_StillCountsAsLogged()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var target = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);

        var service = new ExcessWasteService(db);
        var logged = await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 40, isReusable: true), user.Id);

        var request = new RedistributionRequest
        {
            MaterialId = material.Id, SourceProjectId = project.Id, TargetProjectId = target.Id,
            SourceExcessWasteRecordId = logged.Id, Quantity = 30, Status = RedistributionStatus.PendingApproval,
        };
        db.RedistributionRequests.Add(request);
        await db.SaveChangesAsync();
        await new RedistributionService(db, new NotificationService(db)).ApproveTransferAsync(request.Id, user.Id);

        var record = (await service.GetByProjectAsync(project.Id)).Single();
        Assert.Equal(10, record.Quantity);        // left to redistribute
        Assert.Equal(40, record.LoggedQuantity);  // what the log shows

        var line = (await service.GetLoggableBOQItemsAsync(project.Id)).Single();
        Assert.Equal(40, line.AlreadyLogged);
        Assert.Equal(40, line.ExcessLogged);

        // Only 60 of the 100 is still unaccounted for — not 90.
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 61, isReusable: true), user.Id));

        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 10, isReusable: false), user.Id);
        var saved = await db.BOQItems.AsNoTracking().FirstAsync(b => b.Id == boq.Id);
        Assert.Equal(50, saved.ActualQuantity);
    }

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

        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
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

        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
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

        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
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

    [Fact]
    public async Task CreateAsync_RequiresSpecificBoqItemLink()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 50);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateAsync(Dto(project.Id, material.Id, null, 5, isReusable: true), user.Id));
    }

    [Fact]
    public async Task CreateAsync_RejectsMaterialThatDoesNotMatchBoqItem()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var otherMaterial = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 50);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.CreateAsync(Dto(project.Id, otherMaterial.Id, boq.Id, 5, isReusable: true), user.Id));
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

        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(70, summary[0].ActualUsage); // 100 - 30, not 100 - 30*3
        Assert.Equal(30, summary[0].ExcessTotal);
    }

    [Fact] // Case 9: recording Excess must not block recording Waste (or more Excess) for the same BOQ item.
    public async Task BothExcessAndWaste_CanBeRecordedForSameItem()
    {
        await using var db = fixture.CreateContext();
        var service = new ExcessWasteService(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 100);

        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 10, isReusable: true), user.Id);

        // The Record Material Excess table still lists the item, with what's
        // been logged so far — so its Actual Usage preview starts from 90.
        var listed = (await service.GetLoggableBOQItemsAsync(project.Id)).Single(p => p.BOQItemId == boq.Id);
        Assert.Equal(10, listed.ExcessLogged);
        Assert.Equal(0, listed.WasteLogged);
        Assert.Equal(100, listed.DeliveredQuantity);

        // And the second (Waste) entry actually succeeds.
        await service.CreateAsync(Dto(project.Id, material.Id, boq.Id, 5, isReusable: false), user.Id);

        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
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

        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
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

        await TestDataBuilder.CompleteProjectAsync(db, project.Id);
        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(user.Id, "Admin", material.Id, null)).ToList();
        Assert.Empty(summary);
    }
}
