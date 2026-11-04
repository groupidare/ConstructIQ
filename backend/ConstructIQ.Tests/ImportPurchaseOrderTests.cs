using System.Reflection;
using System.Security.Claims;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.PurchaseOrders;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// POs made outside the system for a project that was already under way when
// it was entered: saved as IMP-00n, the paper PO's number kept, no
// notifications, and counted like any other PO.
[Collection("Database")]
public class ImportPurchaseOrderTests(DatabaseFixture fixture)
{
    [Fact]
    public async Task Import_SavesAnImportedPo_InItsOwnSequence_WithoutTouchingThePoSequence()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var nextPoBefore = await PoNumberGenerator.NextAsync(db);

        var dto = Valid(project.Id, material.Id) with { OriginalPoNumber = "  PO-005  " };
        var ok = Assert.IsType<OkObjectResult>(await ImportAs(db, admin, dto));
        var result = Assert.IsType<PurchaseOrderDto>(ok.Value);

        Assert.True(result.IsImported);
        Assert.Matches(@"^IMP-\d{3,}$", result.Number);
        Assert.Equal("PO-005", result.OriginalPoNumber);
        Assert.Equal("Approved", result.Status);
        Assert.Equal(nextPoBefore, await PoNumberGenerator.NextAsync(db));
        // The paper number "PO-005" is never taken as one of the system's own.
        Assert.False(await db.PurchaseOrders.AnyAsync(p => p.Number == "PO-005"));
    }

    [Fact]
    public async Task Import_ConsecutiveImports_GetConsecutiveImportedNumbers()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");

        var first = await ImportedNumberAsync(db, admin, Valid(project.Id, material.Id));
        var second = await ImportedNumberAsync(db, admin, Valid(project.Id, material.Id));

        Assert.Equal(PoNumberGenerator.ParseImported(first) + 1, PoNumberGenerator.ParseImported(second));
    }

    [Fact]
    public async Task Import_Delivered_IsSavedDelivered_AndCountsAsDelivered()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var orderDate = new DateTime(2026, 3, 1);

        var dto = Valid(project.Id, material.Id) with { Delivered = true, ExpectedDate = null, OrderDate = orderDate };
        var result = Assert.IsType<PurchaseOrderDto>(Assert.IsType<OkObjectResult>(await ImportAs(db, admin, dto)).Value);

        Assert.Equal("Delivered", result.Status);
        Assert.Equal(orderDate, result.ExpectedDate);
    }

    [Fact]
    public async Task Import_SendsNoNotifications()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var before = await db.Notifications.CountAsync();

        // The controller is built with a null notification service — any
        // attempt to notify would throw.
        Assert.IsType<OkObjectResult>(await ImportAs(db, admin, Valid(project.Id, material.Id)));
        Assert.Equal(before, await db.Notifications.CountAsync());
    }

    [Fact]
    public async Task Import_SameOriginalNumberAndSupplierTwice_IsRejected_ButAnotherSupplierIsFine()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var supplier = "JS Builders " + Guid.NewGuid().ToString("N")[..6];
        var dto = Valid(project.Id, material.Id) with { OriginalPoNumber = "2024-118", SupplierName = supplier };

        Assert.IsType<OkObjectResult>(await ImportAs(db, admin, dto));
        Assert.IsType<ConflictObjectResult>(await ImportAs(db, admin, dto with { SupplierName = supplier.ToUpperInvariant() }));
        Assert.IsType<OkObjectResult>(await ImportAs(db, admin, dto with { SupplierName = supplier + " Other" }));
    }

    [Fact]
    public async Task Import_LinkedToAMaterialPlanRow_TakesItsMaterial_AndCountsAsOrdered()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 100, estimatedPurchaseQuantity: 67, estimatedPurchaseUnit: "bag");

        var dto = Valid(project.Id, null) with
        {
            Materials = [new PurchaseOrderMaterialDto { Name = "Skim coat (as written on the PO)", Quantity = 40, Unit = "bag", UnitPrice = 450, BOQItemId = row.Id }],
        };
        Assert.IsType<OkObjectResult>(await ImportAs(db, admin, dto));

        var line = await db.PurchaseOrderMaterials.SingleAsync(m => m.BOQItemId == row.Id);
        Assert.Equal(material.Id, line.MaterialId);

        var cost = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);
        var costLine = Assert.Single(cost!.Lines);
        Assert.Equal(40m, costLine.OrderedQuantity);
        Assert.Equal(18000m, costLine.CommittedCost);
        Assert.Equal(27m, costLine.RemainingQuantity);
    }

    [Fact]
    public async Task Import_LinkToAnotherProjectsRow_IsRejected()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var other = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var otherRow = await TestDataBuilder.CreateBoqItemAsync(db, other.Id, material.Id, admin.Id, 1);

        var dto = Valid(project.Id, material.Id) with
        {
            Materials = [new PurchaseOrderMaterialDto { Name = "Skim coat", Quantity = 1, Unit = "bag", BOQItemId = otherRow.Id }],
        };

        Assert.IsType<BadRequestObjectResult>(await ImportAs(db, admin, dto));
    }

    [Fact]
    public async Task Import_PoFile_MustBelongToTheProject_AndIsKeptOnThePo()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var other = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var doc = await CreateDocumentAsync(db, project.Id, admin.Id);
        var otherDoc = await CreateDocumentAsync(db, other.Id, admin.Id);

        Assert.IsType<BadRequestObjectResult>(await ImportAs(db, admin, Valid(project.Id, material.Id) with { DocumentId = otherDoc.Id }));
        var result = Assert.IsType<PurchaseOrderDto>(Assert.IsType<OkObjectResult>(
            await ImportAs(db, admin, Valid(project.Id, material.Id) with { DocumentId = doc.Id })).Value);
        Assert.Equal(doc.StoragePath, result.PoFileUrl);
    }

    [Fact]
    public async Task Import_InvalidInput_IsRejected()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var historical = await TestDataBuilder.CreateProjectAsync(db, admin.Id, isHistorical: true);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        var valid = Valid(project.Id, material.Id);

        foreach (var dto in new[]
        {
            valid with { SupplierName = " " },
            valid with { ExpectedDate = null },                         // not delivered, no expected date
            valid with { OrderDate = DateTime.UtcNow.AddDays(5) },      // in the future
            valid with { OrderDate = default },
            valid with { Materials = [] },
            valid with { Materials = [new PurchaseOrderMaterialDto { Name = "Skim coat", Quantity = 0, Unit = "bag" }] },
            valid with { Materials = [new PurchaseOrderMaterialDto { Name = "Skim coat", Quantity = 1, Unit = "" }] },
            valid with { Materials = [new PurchaseOrderMaterialDto { Name = "Skim coat", Quantity = 1, Unit = "bag", UnitPrice = -1 }] },
            valid with { ProjectId = historical.Id },
        })
            Assert.IsType<BadRequestObjectResult>(await ImportAs(db, admin, dto));
    }

    [Fact]
    public async Task Import_SiteEngineer_OnlyForTheirOwnProject_ProcurementForAny()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var engineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var otherEngineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var procurement = await TestDataBuilder.CreateUserAsync(db, UserRole.ProcurementOfficer);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id, siteEngineerId: engineer.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");

        Assert.IsType<OkObjectResult>(await ImportAs(db, engineer, Valid(project.Id, material.Id)));
        Assert.IsType<ForbidResult>(await ImportAs(db, otherEngineer, Valid(project.Id, material.Id)));
        Assert.IsType<OkObjectResult>(await ImportAs(db, procurement, Valid(project.Id, material.Id)));
    }

    [Fact]
    public void Import_IsNotOpenToWarehousePersonnel()
    {
        var roles = typeof(PurchaseOrdersController).GetMethod(nameof(PurchaseOrdersController.Import))!
            .GetCustomAttribute<AuthorizeAttribute>()!.Roles!.Split(',');

        Assert.DoesNotContain("WarehousePersonnel", roles);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static ImportPurchaseOrderDto Valid(int projectId, int? materialId) => new()
    {
        ProjectId = projectId,
        SupplierName = "Supplier " + Guid.NewGuid().ToString("N")[..8],
        OrderDate = new DateTime(2026, 2, 1),
        ExpectedDate = new DateTime(2026, 2, 8),
        Materials = [new PurchaseOrderMaterialDto { Name = "Skim coat", Quantity = 10, Unit = "bag", UnitPrice = 450, MaterialId = materialId }],
    };

    private static async Task<string> ImportedNumberAsync(AppDbContext db, User user, ImportPurchaseOrderDto dto) =>
        Assert.IsType<PurchaseOrderDto>(Assert.IsType<OkObjectResult>(await ImportAs(db, user, dto)).Value).Number;

    private static Task<IActionResult> ImportAs(AppDbContext db, User user, ImportPurchaseOrderDto dto) =>
        new PurchaseOrdersController(db, null!, null!) { ControllerContext = ContextFor(user) }
            .Import(dto, new ProjectAccessService(db));

    private static async Task<ProjectDocument> CreateDocumentAsync(AppDbContext db, int projectId, int userId)
    {
        var doc = new ProjectDocument
        {
            ProjectId = projectId, Category = DocumentCategory.PurchaseOrder,
            FileName = "po.pdf", StoragePath = $"documents/{projectId}/{Guid.NewGuid():N}.pdf", UploadedByUserId = userId,
        };
        db.ProjectDocuments.Add(doc);
        await db.SaveChangesAsync();
        return doc;
    }

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
}
