using System.Reflection;
using System.Security.Claims;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Models.DTOs.PurchaseOrders;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Estimated Material Cost: forecasted purchase quantity × latest recorded
// unit price, same material + same normalized purchase unit only.
[Collection("Database")]
public class MaterialCostTests(DatabaseFixture fixture)
{
    // ── Price selection ─────────────────────────────────────────────────────

    [Fact]
    public async Task PriceSources_AreUsedInOrder_PoThenHistoricalThenCatalog()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var historicalProject = await TestDataBuilder.CreateProjectAsync(db, admin.Id, isHistorical: true,
            targetEndDate: new DateTime(2023, 6, 30));

        // Has all three sources → PO price (12) wins.
        var withPo = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, withPo.Id, 1, unit: "pcs", unitPrice: 12);
        var withPoHistBoq = await TestDataBuilder.CreateBoqItemAsync(db, historicalProject.Id, withPo.Id, admin.Id, 1);
        await TestDataBuilder.CreateHistoricalSupplyAsync(db, withPoHistBoq.Id, 1, "pcs", unitCost: 99);

        // No PO price → historical (7) beats catalog (10).
        var withHistorical = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        var histBoq = await TestDataBuilder.CreateBoqItemAsync(db, historicalProject.Id, withHistorical.Id, admin.Id, 1);
        await TestDataBuilder.CreateHistoricalSupplyAsync(db, histBoq.Id, 1, "pcs", unitCost: 7);

        // Catalog only (UnitCost defaults to 10 in the builder).
        var catalogOnly = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");

        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, withPo.Id, admin.Id, 500, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "pcs");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, withHistorical.Id, admin.Id, 500, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "pcs");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, catalogOnly.Id, admin.Id, 500, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "pcs");

        var cost = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);

        Assert.NotNull(cost);
        // 10×12 + 10×7 + 10×10 — the BOQ area quantity (500) is never priced.
        Assert.Equal(290m, cost.TotalEstimatedCost);
        Assert.Equal(3, cost.PricedItems);
        Assert.Equal(0, cost.UnpricedItems);
        Assert.Equal("PHP", cost.Currency);
    }

    [Fact]
    public async Task NoPriceInAnySource_RowIsUnpriced()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        material.UnitCost = 0;
        await db.SaveChangesAsync();
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 1, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "pcs");

        var cost = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);

        Assert.Equal(0m, cost!.TotalEstimatedCost);
        Assert.Equal(0, cost.PricedItems);
        Assert.Equal(1, cost.UnpricedItems);
        Assert.Null(cost.OldestPriceDate);
    }

    [Fact]
    public async Task LatestDateWins_WithinPoAndHistoricalSources()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);

        var poMaterial = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, poMaterial.Id, 1, unit: "pcs", unitPrice: 50, orderDate: new DateTime(2025, 1, 1));
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, poMaterial.Id, 1, unit: "pcs", unitPrice: 20, orderDate: new DateTime(2022, 1, 1));

        var histMaterial = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        var older = await TestDataBuilder.CreateProjectAsync(db, admin.Id, isHistorical: true, targetEndDate: new DateTime(2021, 1, 1));
        var newer = await TestDataBuilder.CreateProjectAsync(db, admin.Id, isHistorical: true, targetEndDate: new DateTime(2024, 1, 1));
        await TestDataBuilder.CreateHistoricalSupplyAsync(db,
            (await TestDataBuilder.CreateBoqItemAsync(db, older.Id, histMaterial.Id, admin.Id, 1)).Id, 1, "pcs", unitCost: 3);
        await TestDataBuilder.CreateHistoricalSupplyAsync(db,
            (await TestDataBuilder.CreateBoqItemAsync(db, newer.Id, histMaterial.Id, admin.Id, 1)).Id, 1, "pcs", unitCost: 5);

        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, poMaterial.Id, admin.Id, 1, estimatedPurchaseQuantity: 2, estimatedPurchaseUnit: "pcs");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, histMaterial.Id, admin.Id, 1, estimatedPurchaseQuantity: 2, estimatedPurchaseUnit: "pcs");

        var cost = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);

        Assert.Equal(2 * 50m + 2 * 5m, cost!.TotalEstimatedCost);
        Assert.Equal(new DateTime(2024, 1, 1), cost.OldestPriceDate);
        Assert.Equal(new DateTime(2025, 1, 1), cost.NewestPriceDate);
    }

    [Fact]
    public async Task UnitMismatch_MakesRowUnpriced_ButPcVariantsStillMatch()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);

        // Priced only per box (PO) and per sq.m (catalog) — purchase unit is pcs.
        var mismatched = await TestDataBuilder.CreateMaterialAsync(db, unit: "sq.m");
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, mismatched.Id, 1, unit: "box", unitPrice: 100);

        // "PCS " normalizes to the same unit as "pieces".
        var normalized = await TestDataBuilder.CreateMaterialAsync(db, unit: "sq.m");
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, normalized.Id, 1, unit: "PCS ", unitPrice: 4);

        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, mismatched.Id, admin.Id, 1, estimatedPurchaseQuantity: 3, estimatedPurchaseUnit: "pcs");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, normalized.Id, admin.Id, 1, estimatedPurchaseQuantity: 3, estimatedPurchaseUnit: "pieces");

        var cost = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);

        Assert.Equal(12m, cost!.TotalEstimatedCost);
        Assert.Equal(1, cost.PricedItems);
        Assert.Equal(1, cost.UnpricedItems);
    }

    [Fact]
    public async Task RowsWithoutPurchaseQuantityOrUnit_AreExcludedAndCounted()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");

        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 100, estimatedPurchaseQuantity: 4, estimatedPurchaseUnit: "pcs");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 100, estimatedPurchaseQuantity: null, estimatedPurchaseUnit: "pcs");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 100, estimatedPurchaseQuantity: 4, estimatedPurchaseUnit: null);

        var cost = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);

        Assert.Equal(40m, cost!.TotalEstimatedCost); // only the complete row, at catalog 10
        Assert.Equal(1, cost.PricedItems);
        Assert.Equal(2, cost.UnpricedItems);
    }

    [Fact]
    public async Task MissingProject_ReturnsNull()
    {
        await using var db = fixture.CreateContext();
        Assert.Null(await new MaterialCostService(db).GetEstimatedMaterialCostAsync(int.MaxValue));
    }

    // ── PO price visibility ─────────────────────────────────────────────────

    [Theory]
    [InlineData(UserRole.Admin, true)]
    [InlineData(UserRole.ProcurementOfficer, true)]
    [InlineData(UserRole.ProjectManager, false)]
    [InlineData(UserRole.SiteEngineer, false)]
    [InlineData(UserRole.WarehousePersonnel, false)]
    public async Task PoUnitPrice_IsOnlyReturnedToAdminAndProcurementOfficer(UserRole role, bool seesPrice)
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var viewer = await TestDataBuilder.CreateUserAsync(db, role);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, material.Id, 5, unit: "pcs", unitPrice: 123.45m);

        var controller = new PurchaseOrdersController(db, null!, null!) { ControllerContext = ContextFor(viewer) };
        var result = Assert.IsType<OkObjectResult>(await controller.GetAll(project.Id));
        var line = Assert.Single(Assert.Single(Assert.IsAssignableFrom<IEnumerable<PurchaseOrderDto>>(result.Value)).Materials);

        Assert.Equal(seesPrice ? 123.45m : null, line.UnitPrice);
    }

    // ── Endpoint roles and project scoping ──────────────────────────────────

    [Fact]
    public void Endpoint_IsLimitedToAdminProjectManagerAndSiteEngineer()
    {
        var attribute = typeof(ProjectsController)
            .GetMethod(nameof(ProjectsController.GetEstimatedMaterialCost))!
            .GetCustomAttribute<AuthorizeAttribute>();

        Assert.Equal("Admin,ProjectManager,SiteEngineer", attribute?.Roles);
    }

    [Fact]
    public async Task Endpoint_SiteEngineerSeesOnlyAssignedProjects()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var assignedEngineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var otherEngineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id, siteEngineerId: assignedEngineer.Id);

        Assert.IsType<OkObjectResult>(await EndpointAs(db, assignedEngineer, project.Id));
        Assert.IsType<ForbidResult>(await EndpointAs(db, otherEngineer, project.Id));
    }

    [Theory]
    [InlineData(UserRole.Admin)]
    [InlineData(UserRole.ProjectManager)]
    public async Task Endpoint_AdminAndProjectManagerSeeAnyProject(UserRole role)
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var viewer = await TestDataBuilder.CreateUserAsync(db, role);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);

        var ok = Assert.IsType<OkObjectResult>(await EndpointAs(db, viewer, project.Id));
        Assert.Equal(project.Id, Assert.IsType<EstimatedMaterialCostDto>(ok.Value).ProjectId);
    }

    [Theory]
    [InlineData(UserRole.ProcurementOfficer)]
    [InlineData(UserRole.WarehousePersonnel)]
    public async Task Endpoint_OtherRolesAreForbidden(UserRole role)
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var viewer = await TestDataBuilder.CreateUserAsync(db, role);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);

        Assert.IsType<ForbidResult>(await EndpointAs(db, viewer, project.Id));
    }

    // ── Scanned UNIT COST survives a later BOQ re-save ───────────────────────

    [Fact]
    public async Task BoqResave_WithoutUnitCost_KeepsTheStoredHistoricalCost()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id, isHistorical: true);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        var service = new BOQService(db);

        HistoricalSupplyLineDto Line(decimal? unitCost) => new()
        {
            PoNumber = "PO-1", MaterialName = "Deformed Bar", Unit = "pcs", Quantity = 40, UnitCost = unitCost,
        };
        BOQItemUpsertDto Row(int? id, decimal? unitCost) => new()
        {
            Id = id, PrimarySection = "Structural", MaterialId = material.Id, Unit = "pcs",
            EstimatedQuantity = 40, HistoricalSupply = [Line(unitCost)],
        };

        var saved = Assert.Single(await service.BulkSaveAsync(project.Id, [Row(null, 1250.5m)], admin.Id));
        // The client gets no UnitCost back, so the re-save carries none.
        await service.BulkSaveAsync(project.Id, [Row(saved.Id, null)], admin.Id);

        await using var verify = fixture.CreateContext();
        var stored = await verify.HistoricalMaterialSupplies.SingleAsync(h => h.BOQItemId == saved.Id);
        Assert.Equal(1250.5m, stored.UnitCost);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static ControllerContext ContextFor(User user) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
            ], "Test")),
        },
    };

    private static Task<IActionResult> EndpointAs(ConstructIQ.API.Data.AppDbContext db, User user, int projectId) =>
        new ProjectsController(null!, new ProjectAccessService(db), new MaterialCostService(db))
            { ControllerContext = ContextFor(user) }
            .GetEstimatedMaterialCost(projectId);
}
