using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// A warehouse release uses up logged Excess oldest first, so the same material
// can't also be redistributed, and goes out on the sheet's STOCK OUT.
[Collection("Database")]
public class WarehouseReleaseTests(DatabaseFixture fixture)
{
    private sealed class FakeSheet(bool enabled = true) : IExcessSheetSync
    {
        public int Triggers { get; private set; }
        public bool Enabled => enabled;
        public void Trigger() => Triggers++;
    }

    private sealed record Seed(User User, Project Project, Material Material, BOQItem Row);

    private static async Task<Seed> SeedAsync(AppDbContext db)
    {
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pc");
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 100, "sq.m", 200, "pc");
        return new Seed(user, project, material, row);
    }

    private static async Task<ExcessWasteRecord> ExcessAsync(AppDbContext db, Seed s, decimal quantity, DateTime recordedAt,
        bool reusable = true, bool onSheet = true, int? materialId = null, string? unit = null)
    {
        var source = await TestDataBuilder.CreateProjectAsync(db, s.User.Id);
        var boqItem = unit is null ? null : await TestDataBuilder.CreateBoqItemAsync(db, source.Id, materialId ?? s.Material.Id, s.User.Id, 100, "sq.m", 200, unit);
        var record = new ExcessWasteRecord
        {
            ProjectId = source.Id, MaterialId = materialId ?? s.Material.Id, BOQItemId = boqItem?.Id,
            ExcessType = ExcessType.Unused, Quantity = quantity, UnitCost = 10, TotalCost = quantity * 10,
            IsReusable = reusable, RecordedByUserId = s.User.Id, RecordedAt = recordedAt,
            SheetSyncedAt = onSheet ? recordedAt : null,
        };
        db.ExcessWasteRecords.Add(record);
        await db.SaveChangesAsync();
        return record;
    }

    private static async Task<WarehouseRequestResponseDto> ApproveAsync(AppDbContext db, Seed s, decimal requested, decimal approved, IExcessSheetSync? sheet = null)
    {
        var service = new WarehouseRequestService(db, new NotificationService(db), sheet);
        var request = await service.CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, RequestedQuantity = requested, Unit = "pc",
        }, s.User.Id);
        Assert.True(await service.ApproveAsync(request.Id, approved, s.User.Id));
        return request;
    }

    private static readonly DateTime Older = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Newer = new(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Allocate_TakesTheOldestFirst_AndStopsAtTheQuantity()
    {
        var pool = new OldestExcessFirst.Available[] { new(1, 50), new(2, 50) };

        Assert.Equal([new(1, 50), new(2, 25)], OldestExcessFirst.Allocate(pool, 75));
        Assert.Equal([new(1, 50), new(2, 10)], OldestExcessFirst.Allocate(pool, 60));
        Assert.Equal([new(1, 30)], OldestExcessFirst.Allocate(pool, 30));
        Assert.Equal([new(1, 50), new(2, 50)], OldestExcessFirst.Allocate(pool, 500));
        Assert.Empty(OldestExcessFirst.Allocate(pool, 0));
        Assert.Empty(OldestExcessFirst.Allocate([], 10));
    }

    [Fact] // The 75 of 100 example: 50 + 50 of excess, one used up, one with 25 left.
    public async Task Approval_UsesUpExcessOldestFirst_AndRecordsTheSplit()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var newer = await ExcessAsync(db, s, 50, Newer);
        var older = await ExcessAsync(db, s, 50, Older);

        var request = await ApproveAsync(db, s, 75, 75);

        await using var after = fixture.CreateContext();
        var a = await after.ExcessWasteRecords.SingleAsync(e => e.Id == older.Id);
        var b = await after.ExcessWasteRecords.SingleAsync(e => e.Id == newer.Id);
        Assert.Equal((0m, 50m, 0m), (a.Quantity, a.RedistributedQuantity, a.TotalCost));
        Assert.Equal((25m, 25m, 250m), (b.Quantity, b.RedistributedQuantity, b.TotalCost));

        var shown = (await new WarehouseRequestService(after, new NotificationService(after)).GetByProjectAsync(s.Project.Id)).Single(r => r.Id == request.Id);
        var olderName = await after.Projects.Where(p => p.Id == older.ProjectId).Select(p => p.Name).SingleAsync();
        var newerName = await after.Projects.Where(p => p.Id == newer.ProjectId).Select(p => p.Name).SingleAsync();
        Assert.Equal([(olderName, 50m), (newerName, 25m)], shown.ReleaseSources.Select(r => (r.ProjectName, r.Quantity)));

        // What's left to order follows the approval, whoever's excess it was.
        Assert.Equal(125, (await ProcurementCapCalculator.GetRowStatusesAsync(after, s.Project.Id))[s.Row.Id].NetLeftToOrder);
    }

    [Fact]
    public async Task PartialApproval_OnlyUsesWhatWasApproved()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var older = await ExcessAsync(db, s, 50, Older);
        var newer = await ExcessAsync(db, s, 50, Newer);

        await ApproveAsync(db, s, 75, 60);

        await using var after = fixture.CreateContext();
        Assert.Equal(0, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == older.Id)).Quantity);
        Assert.Equal(40, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == newer.Id)).Quantity);
    }

    [Fact] // The Excess page's "where did it go", per project, from each approval.
    public async Task ExcessLog_ShowsWhereTheWarehouseReleasedIt()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 100, Older);
        var untouched = await ExcessAsync(db, s, 10, Newer);

        await ApproveAsync(db, s, 30, 30);
        await ApproveAsync(db, s, 20, 20);

        await using var after = fixture.CreateContext();
        var shown = (await new ExcessWasteService(after).GetByProjectAsync(record.ProjectId)).Single();
        var release = Assert.Single(shown.WarehouseReleases);
        Assert.Equal((s.Project.Name, 50m), (release.ProjectName, release.Quantity));
        Assert.Equal((50m, 100m), (shown.Quantity, shown.LoggedQuantity));
        Assert.Empty((await new ExcessWasteService(after).GetByProjectAsync(untouched.ProjectId)).Single().WarehouseReleases);
    }

    [Fact] // Beyond the excess it's regular stock, which has no record to reduce.
    public async Task ReleaseBeyondTheExcess_TakesOnlyWhatExists()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 20, Older);

        var request = await ApproveAsync(db, s, 75, 75);

        await using var after = fixture.CreateContext();
        Assert.Equal(0, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == record.Id)).Quantity);
        Assert.Equal(20, (await after.WarehouseReleaseSources.SingleAsync(r => r.WarehouseRequestId == request.Id)).Quantity);
    }

    [Fact]
    public async Task OnlyReusableExcess_OnTheSheet_OfTheSameMaterialAndUnit_IsUsed()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var other = await TestDataBuilder.CreateMaterialAsync(db, unit: "pc");
        var notReusable = await ExcessAsync(db, s, 10, Older, reusable: false);
        var notOnSheet = await ExcessAsync(db, s, 10, Older, onSheet: false);
        var otherMaterial = await ExcessAsync(db, s, 10, Older, materialId: other.Id);
        var otherUnit = await ExcessAsync(db, s, 10, Older, unit: "roll");
        var sameUnitSpeltDifferently = await ExcessAsync(db, s, 10, Older, unit: "pcs");

        var request = await ApproveAsync(db, s, 75, 75);

        await using var after = fixture.CreateContext();
        var used = await after.WarehouseReleaseSources.Where(r => r.WarehouseRequestId == request.Id).ToListAsync();
        Assert.Equal(sameUnitSpeltDifferently.Id, Assert.Single(used).ExcessWasteRecordId);
        foreach (var untouched in new[] { notReusable, notOnSheet, otherMaterial, otherUnit })
            Assert.Equal(10, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == untouched.Id)).Quantity);
    }

    private static async Task LinkAsync(AppDbContext db, string wording, string warehouseName)
    {
        db.WarehouseStockLinks.Add(new WarehouseStockLink { BoqNameKey = StockInSheetRows.NameKey(wording), WarehouseMaterialName = warehouseName });
        await db.SaveChangesAsync();
    }

    private static WarehouseItemMatch.Item Item(int materialId, string? wording, string material) => new(materialId, wording, material);

    [Fact]
    public void Same_GoesByTheLink_ThenTheMaterial_ThenTheName()
    {
        var links = new Dictionary<string, string> { ["concrete class a"] = "CHB 150mm", ["hollow block"] = "CHB 150mm", ["sand"] = "Sand, washed" };

        // Linked to the warehouse item, whatever its catalog Material says.
        Assert.True(WarehouseItemMatch.Same(Item(1, "Concrete Class A", "Concrete"), Item(2, null, "CHB 150mm"), links));
        Assert.True(WarehouseItemMatch.Same(Item(1, "Concrete Class A", "Concrete"), Item(2, "Hollow Block", "Blocks"), links));
        // Linked elsewhere: a merged catalog Material doesn't make them the same.
        Assert.False(WarehouseItemMatch.Same(Item(1, "Concrete Class A", "Merged"), Item(1, "Rebar", "Merged"), links));
        Assert.False(WarehouseItemMatch.Same(Item(1, "Concrete Class A", "Merged"), Item(1, "Sand", "Merged"), links));
        // No links: same Material or same name.
        Assert.True(WarehouseItemMatch.Same(Item(1, "Rebar 10mm", "Rebar"), Item(1, "Rebar, ten", "Rebar"), links));
        Assert.True(WarehouseItemMatch.Same(Item(1, "Paint", "A"), Item(2, "PAINT", "B"), links));
        Assert.False(WarehouseItemMatch.Same(Item(1, "Paint", "A"), Item(2, "Rebar", "B"), links));
    }

    [Fact] // Your test: a row under another catalog Material, linked to the excess's item.
    public async Task Approval_FindsExcess_ThroughTheStockLink()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var wording = "Concrete Class A " + Guid.NewGuid().ToString("N")[..8];
        s.Row.Specification = wording;
        await db.SaveChangesAsync();
        var block = await TestDataBuilder.CreateMaterialAsync(db, unit: "pc");
        await LinkAsync(db, wording, block.Name);
        var older = await ExcessAsync(db, s, 100, Older, materialId: block.Id);
        var newer = await ExcessAsync(db, s, 100, Newer, materialId: block.Id);

        await ApproveAsync(db, s, 150, 150);

        await using var after = fixture.CreateContext();
        Assert.Equal(0, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == older.Id)).Quantity);
        Assert.Equal(50, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == newer.Id)).Quantity);
    }

    [Fact] // Linked to one item, so excess of what its catalog Material merged with stays.
    public async Task Approval_LeavesExcessOfTheSameMaterial_WhenLinkedToAnotherItem()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var wording = "Concrete Class A " + Guid.NewGuid().ToString("N")[..8];
        s.Row.Specification = wording;
        await db.SaveChangesAsync();
        await LinkAsync(db, wording, "Some other warehouse item " + wording);
        var record = await ExcessAsync(db, s, 50, Older);

        await ApproveAsync(db, s, 30, 30);

        await using var after = fixture.CreateContext();
        Assert.Equal(50, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == record.Id)).Quantity);
    }

    private static WarehouseRequestService Requests(AppDbContext db) => new(db, new NotificationService(db));
    private static RedistributionService Transfers(AppDbContext db) => new(db, new NotificationService(db));

    private static Task<WarehouseRequestResponseDto> AskAsync(AppDbContext db, Seed s, decimal quantity) =>
        Requests(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, RequestedQuantity = quantity, Unit = "pc",
        }, s.User.Id);

    private static async Task<RedistributionRequest> TransferAsync(AppDbContext db, ExcessWasteRecord record, int targetProjectId, decimal quantity, RedistributionStatus status)
    {
        var transfer = new RedistributionRequest
        {
            MaterialId = record.MaterialId, SourceProjectId = record.ProjectId, TargetProjectId = targetProjectId,
            SourceExcessWasteRecordId = record.Id, Quantity = quantity, Status = status,
        };
        db.RedistributionRequests.Add(transfer);
        await db.SaveChangesAsync();
        return transfer;
    }

    [Fact]
    public async Task NewTransfer_IsRefused_WhileAWarehouseRequestWaits()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 100, Older);
        await AskAsync(db, s, 150);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Transfers(db).CreateFromExcessRecordAsync(new() { ExcessWasteRecordId = record.Id, TargetProjectId = s.Project.Id, Quantity = 50 }, s.User.Id));

        Assert.Contains("150 pc", error.Message);
        Assert.Contains("Inventory", error.Message);
        Assert.False(await db.RedistributionRequests.AnyAsync(r => r.SourceExcessWasteRecordId == record.Id));
    }

    [Fact]
    public async Task ApprovingATransfer_IsRefused_WhileAWarehouseRequestWaits()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 100, Older);
        var transfer = await TransferAsync(db, record, s.Project.Id, 50, RedistributionStatus.AiSuggested);
        await AskAsync(db, s, 150);

        await Assert.ThrowsAsync<InvalidOperationException>(() => Transfers(db).ApproveTransferAsync(transfer.Id, s.User.Id));

        await using var after = fixture.CreateContext();
        Assert.Equal(100, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == record.Id)).Quantity);
    }

    [Fact]
    public async Task ApprovingARequest_IsRefused_WhileATransferSomeoneAskedForWaits()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 100, Older);
        var request = await AskAsync(db, s, 150);
        await TransferAsync(db, record, s.Project.Id, 50, RedistributionStatus.PendingApproval);

        await Assert.ThrowsAsync<InvalidOperationException>(() => Requests(db).ApproveAsync(request.Id, 150, s.User.Id));

        await using var after = fixture.CreateContext();
        Assert.Equal(WarehouseRequestStatus.Pending, (await after.WarehouseRequests.SingleAsync(w => w.Id == request.Id)).Status);
    }

    [Fact] // Only a suggestion: the approval makes it out of date and uses its excess.
    public async Task ApprovingARequest_RetiresAiSuggestions_AndUsesTheirExcess()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 100, Older);
        var request = await AskAsync(db, s, 60);
        var suggestion = await TransferAsync(db, record, s.Project.Id, 50, RedistributionStatus.AiSuggested);

        Assert.True(await Requests(db).ApproveAsync(request.Id, 60, s.User.Id));

        await using var after = fixture.CreateContext();
        Assert.Equal(RedistributionStatus.Rejected, (await after.RedistributionRequests.SingleAsync(r => r.Id == suggestion.Id)).Status);
        Assert.Equal(40, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == record.Id)).Quantity);
    }

    [Fact] // The sheet would be told the full amount, more than is left.
    public async Task ApprovingATransfer_ForMoreThanIsLeft_IsRefused()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 20, Older);
        var other = await TestDataBuilder.CreateProjectAsync(db, s.User.Id);
        var transfer = await TransferAsync(db, record, other.Id, 50, RedistributionStatus.PendingApproval);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Transfers(db).ApproveTransferAsync(transfer.Id, s.User.Id));
        Assert.Contains("Only 20", error.Message);
    }

    [Fact]
    public async Task CancellingAnApproval_PutsTheExcessBack_SoItCanBeApprovedAgain()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 50, Older);
        var other = await TestDataBuilder.CreateProjectAsync(db, s.User.Id);
        var transfer = await TransferAsync(db, record, other.Id, 50, RedistributionStatus.PendingApproval);
        var service = Transfers(db);

        Assert.True(await service.ApproveTransferAsync(transfer.Id, s.User.Id));
        Assert.Equal(0, record.Quantity);
        Assert.True(await service.CancelApprovalAsync(transfer.Id));
        Assert.Equal((50m, 0m), (record.Quantity, record.RedistributedQuantity));
        Assert.True(await service.ApproveTransferAsync(transfer.Id, s.User.Id));
        Assert.Equal((0m, 50m), (record.Quantity, record.RedistributedQuantity));
    }

    [Fact] // Already promised to a transfer someone's deciding on, to another project.
    public async Task ExcessAwaitingARedistributionDecision_IsLeftAlone()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 50, Older);
        var elsewhere = await TestDataBuilder.CreateProjectAsync(db, s.User.Id);
        db.RedistributionRequests.Add(new RedistributionRequest
        {
            MaterialId = s.Material.Id, SourceProjectId = record.ProjectId, TargetProjectId = elsewhere.Id,
            SourceExcessWasteRecordId = record.Id, Quantity = 50, Status = RedistributionStatus.PendingApproval,
        });
        await db.SaveChangesAsync();

        await ApproveAsync(db, s, 30, 30);

        await using var after = fixture.CreateContext();
        Assert.Equal(50, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == record.Id)).Quantity);
    }

    [Fact] // Otherwise the batch suggestions would still offer what was released.
    public async Task Approval_AlsoLowersTheSourceProjectsInventoryExcess()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 50, Older);
        db.InventoryRecords.Add(new InventoryRecord { ProjectId = record.ProjectId, MaterialId = s.Material.Id, ExcessQuantity = 50 });
        await db.SaveChangesAsync();

        await ApproveAsync(db, s, 30, 30);

        await using var after = fixture.CreateContext();
        Assert.Equal(20, (await after.InventoryRecords.SingleAsync(i => i.ProjectId == record.ProjectId && i.MaterialId == s.Material.Id)).ExcessQuantity);
    }

    [Fact]
    public async Task RejectedRequest_UsesNoExcess()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 50, Older);
        var service = new WarehouseRequestService(db, new NotificationService(db), new FakeSheet());
        var request = await service.CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, RequestedQuantity = 30, Unit = "pc",
        }, s.User.Id);

        await service.RejectAsync(request.Id, s.User.Id);

        await using var after = fixture.CreateContext();
        Assert.Equal(50, (await after.ExcessWasteRecords.SingleAsync(e => e.Id == record.Id)).Quantity);
        Assert.False((await after.WarehouseRequests.SingleAsync(w => w.Id == request.Id)).SheetSyncPending);
    }

    [Fact]
    public async Task UsedExcess_CantBeEditedOrDeleted()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var record = await ExcessAsync(db, s, 50, Older);
        await ApproveAsync(db, s, 30, 30);

        var excess = new ExcessWasteService(db);
        await Assert.ThrowsAsync<InvalidOperationException>(() => excess.UpdateAsync(record.Id, new() { ExcessType = nameof(ExcessType.Unused), Quantity = 99 }));
        await Assert.ThrowsAsync<InvalidOperationException>(() => excess.DeleteAsync(record.Id));
    }

    [Fact]
    public async Task Approval_QueuesAStockOutRow_OnlyWhenTheSheetIsOn()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var on = new FakeSheet();

        var request = await ApproveAsync(db, s, 30, 30, on);
        Assert.True((await db.WarehouseRequests.SingleAsync(w => w.Id == request.Id)).SheetSyncPending);
        Assert.Equal(1, on.Triggers);

        var off = await ApproveAsync(db, s, 5, 5, new FakeSheet(enabled: false));
        await using var after = fixture.CreateContext();
        Assert.False((await after.WarehouseRequests.SingleAsync(w => w.Id == off.Id)).SheetSyncPending);
    }

    [Fact] // BOQ wording linked to the warehouse's own name is what the sheet knows it as.
    public void StockOutEntry_UsesTheLinkedName_ForTheRequestingProject()
    {
        var request = new WarehouseRequest
        {
            Id = 7, Unit = "pc", ApprovedQuantity = 75,
            Project = new Project { Name = "Marianne House" },
            Material = new Material { Name = "CHB catalog name", Unit = "pc" },
            BOQItem = new BOQItem { Specification = "Concrete Hollow Block 4 in" },
        };
        var links = new Dictionary<string, string> { [StockInSheetRows.NameKey("Concrete Hollow Block 4 in")] = "CHB 100mm" };

        var entry = ExcessSheetSyncService.ReleaseEntry(request, links);

        Assert.Equal((7, "CHB 100mm", "pc", 75m, "Marianne House"), (entry.RequestId, entry.MaterialName, entry.Unit, entry.Quantity, entry.TargetProjectName));
        Assert.Equal("CHB catalog name", ExcessSheetSyncService.ReleaseEntry(request, new Dictionary<string, string>()).MaterialName);
    }
}
