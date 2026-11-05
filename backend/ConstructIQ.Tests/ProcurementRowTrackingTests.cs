using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Saving can merge different BOQ rows into one catalog Material, so what's left
// to request is worked out per row: THHN wire in rolls and PVC conduit in pieces
// must not complete each other.
[Collection("Database")]
public class ProcurementRowTrackingTests(DatabaseFixture fixture)
{
    private sealed record Seed(User User, Project Project, Material Material, BOQItem Wire14, BOQItem Wire35, BOQItem Conduit);

    private static async Task<Seed> SeedThreeRowsOfOneMaterialAsync(AppDbContext db)
    {
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var wire14 = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 30, "l.m", 3, "roll");
        var wire35 = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 750, "l.m", 3, "roll");
        var conduit = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 230, "l.m", 103, "pc");
        return new Seed(user, project, material, wire14, wire35, conduit);
    }

    private static WarehouseRequestService Warehouse(AppDbContext db) => new(db, new NotificationService(db));

    private static async Task<WarehouseRequestResponseDto> RequestAndApproveAsync(AppDbContext db, Seed s, BOQItem row, decimal quantity, string unit)
    {
        var service = Warehouse(db);
        var request = await service.CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = row.Id, RequestedQuantity = quantity, Unit = unit,
        }, s.User.Id);
        await service.ApproveAsync(request.Id, quantity, s.User.Id);
        return request;
    }

    [Fact]
    public async Task ApprovedRequest_CompletesOnlyItsOwnRow()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);

        await RequestAndApproveAsync(db, s, s.Wire35, 3, "roll");

        var statuses = await ProcurementCapCalculator.GetRowStatusesAsync(db, s.Project.Id);
        Assert.Equal(new ProcurementCapCalculator.RowStatus(0, 0, true, 0, 3, 3), statuses[s.Wire35.Id]);
        // Neither left to order nor unlocked by the other row's approval.
        Assert.Equal(new ProcurementCapCalculator.RowStatus(3, 3, false), statuses[s.Wire14.Id]);
        Assert.Equal(new ProcurementCapCalculator.RowStatus(103, 103, false), statuses[s.Conduit.Id]);
    }

    [Fact] // What's covered can't depend on the BOQ measure standing in for an estimate.
    public async Task RowWithNoEstimate_HasNothingCovered()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 169);

        var status = (await ProcurementCapCalculator.GetRowStatusesAsync(db, project.Id))[row.Id];

        Assert.Equal(0, status.ApprovedQuantity);
        Assert.Equal(0, status.AskedQuantity);
    }

    [Fact] // A partial approval is what a raised estimate gets reduced by.
    public async Task PartialApproval_ReportsWhatWasCovered()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);

        await RequestAndApproveAsync(db, s, s.Conduit, 40, "pc");

        var status = (await ProcurementCapCalculator.GetRowStatusesAsync(db, s.Project.Id))[s.Conduit.Id];
        Assert.Equal(40, status.ApprovedQuantity);
        Assert.Equal(40, status.AskedQuantity);
        Assert.Equal(63, status.NetLeftToOrder);
    }

    [Fact] // 12 l.m of transferred wire must not read as a 3-roll row being done.
    public async Task Transfer_CountsForNoRowOfAMaterialWithSeveral()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);
        var source = await TestDataBuilder.CreateProjectAsync(db, s.User.Id);
        db.RedistributionRequests.Add(new RedistributionRequest
        {
            MaterialId = s.Material.Id, SourceProjectId = source.Id, TargetProjectId = s.Project.Id,
            Quantity = 12, Status = RedistributionStatus.Approved,
        });
        await db.SaveChangesAsync();

        var statuses = await ProcurementCapCalculator.GetRowStatusesAsync(db, s.Project.Id);
        Assert.Equal(new ProcurementCapCalculator.RowStatus(3, 3, false), statuses[s.Wire14.Id]);
        Assert.Equal(new ProcurementCapCalculator.RowStatus(3, 3, false), statuses[s.Wire35.Id]);
        Assert.Equal(new ProcurementCapCalculator.RowStatus(103, 103, false), statuses[s.Conduit.Id]);
    }

    [Fact]
    public async Task Transfer_StillCountsForAMaterialsOnlyRow()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var source = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 100, "pc", 40, "pc");
        db.RedistributionRequests.Add(new RedistributionRequest
        {
            MaterialId = material.Id, SourceProjectId = source.Id, TargetProjectId = project.Id,
            Quantity = 30, Status = RedistributionStatus.Approved,
        });
        await db.SaveChangesAsync();

        var status = (await ProcurementCapCalculator.GetRowStatusesAsync(db, project.Id))[row.Id];
        Assert.Equal(10, status.NetLeftToOrder);
        Assert.Equal(10, status.RemainingRequestable);
    }

    [Fact] // Made before rows were tracked, and can't say which row it was for.
    public async Task RequestWithNoRow_CountsForNoRowOfAMaterialWithSeveral()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);
        db.WarehouseRequests.Add(new WarehouseRequest
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, RequestedQuantity = 5, ApprovedQuantity = 5,
            Status = WarehouseRequestStatus.Approved, RequestedByUserId = s.User.Id,
        });
        await db.SaveChangesAsync();

        var statuses = await ProcurementCapCalculator.GetRowStatusesAsync(db, s.Project.Id);
        Assert.Equal(3, statuses[s.Wire14.Id].NetLeftToOrder);
        Assert.Equal(3, statuses[s.Wire35.Id].NetLeftToOrder);
        Assert.Equal(103, statuses[s.Conduit.Id].NetLeftToOrder);
        Assert.All(statuses.Values, status => Assert.False(status.WarehouseApproved));
    }

    [Fact]
    public void MaterialWideCoverage_ReachesOnlyAMaterialsOnlyRow()
    {
        var left = ProcurementCapCalculator.LeftPerRow(
            [new(1, 7, 10), new(2, 7, 10), new(3, 8, 10)],
            new Dictionary<int, decimal> { [1] = 15 },   // over-covering row 1 doesn't spill onto row 2
            new Dictionary<int, decimal> { [7] = 4, [8] = 4 });

        Assert.Equal(0, left[1]);
        Assert.Equal(10, left[2]);
        Assert.Equal(6, left[3]);
    }

    [Fact] // A generated PO line has no BOQ link (that's left to a person); its request has.
    public async Task PurchaseOrder_CountsAgainstTheRowOfTheRequestItFulfils()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);
        var line = await TestDataBuilder.CreateDeliveredPoLineAsync(db, s.Project.Id, s.User.Id, s.Material.Id, 100);
        db.MaterialRequests.Add(new MaterialRequest
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Conduit.Id, Quantity = 100, Unit = "pc",
            RequestedByUserId = s.User.Id, FulfilledByPurchaseOrderId = line.PurchaseOrderId,
        });
        await db.SaveChangesAsync();

        var statuses = await ProcurementCapCalculator.GetRowStatusesAsync(db, s.Project.Id);
        Assert.Equal(3, statuses[s.Conduit.Id].NetLeftToOrder);
        Assert.Equal(3, statuses[s.Conduit.Id].RemainingRequestable);
        Assert.Equal(3, statuses[s.Wire14.Id].NetLeftToOrder);
        Assert.Equal(3, statuses[s.Wire35.Id].NetLeftToOrder);
        // The training-data link stays a person's to make.
        Assert.Null((await db.PurchaseOrderMaterials.AsNoTracking().FirstAsync(m => m.Id == line.Id)).BOQItemId);
    }

    [Fact]
    public async Task WarehouseRequest_KeepsTheUnitItWasAskedIn()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);

        await RequestAndApproveAsync(db, s, s.Wire35, 3, "roll");

        var shown = Assert.Single(await Warehouse(db).GetByProjectAsync(s.Project.Id));
        Assert.Equal("roll", shown.Unit);
        Assert.Equal(s.Wire35.Id, shown.BOQItemId);
    }

    [Fact] // Materials can run short before the project ends.
    public async Task WarehouseRequest_BeyondWhatTheRowNeeds_IsFlaggedNotRefused()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);
        var first = await RequestAndApproveAsync(db, s, s.Wire35, 3, "roll");
        Assert.False(first.IsAdditional);

        var second = await Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Wire35.Id, RequestedQuantity = 2, Unit = "roll",
        }, s.User.Id);

        Assert.True(second.IsAdditional);
        // Another row's own need isn't additional, even with the first row done.
        var other = await Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Conduit.Id, RequestedQuantity = 103, Unit = "pc",
        }, s.User.Id);
        Assert.False(other.IsAdditional);
    }

    [Fact]
    public async Task PendingCheck_BlocksOnlyItsOwnRow()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);
        var service = Warehouse(db);
        WarehouseRequestCreateDto For(BOQItem row) => new()
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = row.Id, RequestedQuantity = 1, Unit = "roll",
        };

        await service.CreateAsync(For(s.Wire35), s.User.Id);

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(For(s.Wire35), s.User.Id));
        await service.CreateAsync(For(s.Wire14), s.User.Id);
    }

    [Fact] // Sent from the cost estimate: only a price is wanted, no material.
    public async Task PriceInquiry_DoesNotCountAsRequested()
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 100, "pc", 40, "pc");
        db.MaterialRequests.Add(new MaterialRequest
        {
            ProjectId = project.Id, MaterialId = material.Id, BOQItemId = row.Id, Quantity = 40, Unit = "pc",
            RequestedByUserId = user.Id, IsPriceInquiry = true,
        });
        await db.SaveChangesAsync();

        Assert.Equal(40, (await ProcurementCapCalculator.GetRowStatusesAsync(db, project.Id))[row.Id].RemainingRequestable);
    }

    [Fact]
    public async Task Request_ForAnotherProjectsRow_IsRefused()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedThreeRowsOfOneMaterialAsync(db);
        var other = await TestDataBuilder.CreateProjectAsync(db, s.User.Id);

        await Assert.ThrowsAsync<InvalidOperationException>(() => Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = other.Id, MaterialId = s.Material.Id, BOQItemId = s.Wire35.Id, RequestedQuantity = 1,
        }, s.User.Id));
    }
}
