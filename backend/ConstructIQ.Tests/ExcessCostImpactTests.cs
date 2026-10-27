using System.Reflection;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.AspNetCore.Authorization;
using Xunit;

namespace ConstructIQ.Tests;

// Excess cost impact: each excess/waste record's quantity × the latest price
// for that material in the record's own unit — same prices and rules as
// Estimated Material Cost.
[Collection("Database")]
public class ExcessCostImpactTests(DatabaseFixture fixture)
{
    [Fact]
    public async Task ExcessAndWaste_AreValuedAtTheLatestPriceInTheRecordUnit()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 100,
            estimatedPurchaseQuantity: 1000, estimatedPurchaseUnit: "pcs");
        // Older PO price, then a newer one — the newer (25) wins over both it and the catalog (10).
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, material.Id, 1, unit: "pcs",
            unitPrice: 20, orderDate: new DateTime(2025, 1, 1));
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, material.Id, 1, unit: "pieces",
            unitPrice: 25, orderDate: new DateTime(2026, 1, 1));

        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, admin.Id, 40, isReusable: true);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, admin.Id, 6, isReusable: false);

        var impact = await new MaterialCostService(db).GetExcessCostImpactAsync(project.Id, includeMaterialBreakdown: true);

        Assert.Equal(1000m, impact.ExcessValue);  // 40 × 25
        Assert.Equal(150m, impact.WasteCost);     // 6 × 25
        Assert.Equal(1150m, impact.TotalCost);
        Assert.Equal(2, impact.PricedRecords);
        Assert.Equal(0, impact.UnpricedRecords);
        Assert.Equal(new DateTime(2026, 1, 1), impact.NewestPriceDate);

        var byProject = Assert.Single(impact.ByProject);
        Assert.Equal(project.Id, byProject.ProjectId);
        Assert.Equal(1000m, byProject.ExcessValue);
        Assert.Equal(150m, byProject.WasteCost);

        var byMaterial = Assert.Single(impact.ByMaterial);
        Assert.Equal(25m, byMaterial.UnitPrice);
        Assert.Equal(40m, byMaterial.ExcessQuantity);
        Assert.Equal(6m, byMaterial.WasteQuantity);
    }

    [Fact]
    public async Task RecordWithNoPriceInItsUnit_IsUnpriced_NotGuessed()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        // Catalog price is per sq.m; the record is logged in bags — no conversion.
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "sq.m");
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 100,
            estimatedPurchaseQuantity: 50, estimatedPurchaseUnit: "bag");
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, admin.Id, 5, isReusable: true);

        var impact = await new MaterialCostService(db).GetExcessCostImpactAsync(project.Id, includeMaterialBreakdown: true);

        Assert.Equal(0m, impact.TotalCost);
        Assert.Equal(0, impact.PricedRecords);
        Assert.Equal(1, impact.UnpricedRecords);
        Assert.Equal(1, Assert.Single(impact.ByProject).UnpricedRecords);
        Assert.Empty(impact.ByMaterial);
        Assert.Null(impact.OldestPriceDate);
    }

    [Fact]
    public async Task MaterialBreakdown_IsLeftOut_WhenNotRequested()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 100,
            estimatedPurchaseQuantity: 100, estimatedPurchaseUnit: "pcs");
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, project.Id, material.Id, boq.Id, admin.Id, 3, isReusable: false);

        var impact = await new MaterialCostService(db).GetExcessCostImpactAsync(project.Id, includeMaterialBreakdown: false);

        Assert.Equal(30m, impact.WasteCost);  // 3 × catalog 10
        Assert.Empty(impact.ByMaterial);
    }

    [Fact]
    public async Task ApprovedTransfers_AreRedistributedValue_PendingOrRejectedAreNot()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var source = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var target = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");  // catalog 10/pc
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, source.Id, material.Id, admin.Id, 100,
            estimatedPurchaseQuantity: 100, estimatedPurchaseUnit: "pcs");
        var record = await TestDataBuilder.CreateExcessWasteRecordAsync(db, source.Id, material.Id, boq.Id, admin.Id, 20, isReusable: true,
            recordedAt: new DateTime(2026, 3, 10));

        foreach (var (status, qty) in new[] { (RedistributionStatus.Approved, 30m), (RedistributionStatus.PendingApproval, 5m), (RedistributionStatus.Rejected, 7m) })
        {
            db.RedistributionRequests.Add(new RedistributionRequest
            {
                MaterialId = material.Id, SourceProjectId = source.Id, TargetProjectId = target.Id,
                SourceExcessWasteRecordId = record.Id, Quantity = qty, Status = status,
                RequestedAt = new DateTime(2026, 4, 1), ApprovedAt = status == RedistributionStatus.Approved ? new DateTime(2026, 4, 2) : null,
            });
        }
        await db.SaveChangesAsync();

        var impact = await new MaterialCostService(db).GetExcessCostImpactAsync(source.Id, includeMaterialBreakdown: false);

        Assert.Equal(200m, impact.ExcessValue);        // 20 still logged × 10
        Assert.Equal(300m, impact.RedistributedValue); // only the approved 30 × 10
        Assert.Equal(300m, Assert.Single(impact.ByProject).RedistributedValue);
        Assert.Equal(0, impact.UnpricedTransfers);

        // Excess by month logged, transfers by month approved.
        Assert.Equal(2, impact.MonthlyTrend.Count);
        Assert.Equal(("2026-03", 200m, 0m), (impact.MonthlyTrend[0].Month, impact.MonthlyTrend[0].ExcessValue, impact.MonthlyTrend[0].RedistributedValue));
        Assert.Equal(("2026-04", 0m, 300m), (impact.MonthlyTrend[1].Month, impact.MonthlyTrend[1].ExcessValue, impact.MonthlyTrend[1].RedistributedValue));
    }

    [Fact]
    public async Task PurchasedValue_UsesDeliveredLinesOwnPrice_ElseLatestPrice()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var priced = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");    // catalog 10/pc
        var unpriced = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        unpriced.UnitCost = 0;
        await db.SaveChangesAsync();

        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, priced.Id, 4, unit: "pcs", unitPrice: 15); // own price: 60
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, priced.Id, 2, unit: "pcs");                // no own price → latest (15): 30
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, unpriced.Id, 9, unit: "pcs");              // no price anywhere
        var notDelivered = await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, priced.Id, 100, unit: "pcs", unitPrice: 15);
        (await db.PurchaseOrders.FindAsync(notDelivered.PurchaseOrderId))!.Status = PurchaseOrderStatus.Pending;
        await db.SaveChangesAsync();

        var impact = await new MaterialCostService(db).GetExcessCostImpactAsync(project.Id, includeMaterialBreakdown: false);

        Assert.Equal(90m, impact.PurchasedValue);
        Assert.Equal(1, impact.UnpricedDeliveries);
        Assert.Equal(90m, Assert.Single(impact.ByProject).PurchasedValue);
    }

    [Fact]
    public void Endpoint_IsLimitedToRolesThatSeeCosts()
    {
        var attribute = typeof(ExcessWasteController)
            .GetMethod(nameof(ExcessWasteController.GetCostImpact))!
            .GetCustomAttribute<AuthorizeAttribute>();

        Assert.Equal("Admin,ProjectManager,ProcurementOfficer", attribute?.Roles);
    }
}
