using System.Security.Claims;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Models.DTOs.MaterialRequests;
using ConstructIQ.API.Models.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Generate P.O. from material requests: procurement enters the price per
// unit, pre-filled with the last price paid for that material in that unit.
[Collection("Database")]
public class GeneratePurchaseOrderPriceTests(DatabaseFixture fixture)
{
    [Fact]
    public async Task Requests_ArePrefilledWithTheLastPriceInTheSameUnit()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, request) = await SeedAsync(db);
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, material.Id, 1, unit: "pcs",
            unitPrice: 18, orderDate: new DateTime(2025, 1, 1));
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, material.Id, 1, unit: "pcs",
            unitPrice: 20, orderDate: new DateTime(2026, 1, 1));
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, material.Id, 1, unit: "box",
            unitPrice: 75, orderDate: new DateTime(2026, 6, 1));

        var result = Assert.IsType<OkObjectResult>(await ControllerAs(db, admin).GetForProject(project.Id));
        var dto = Assert.Single(Assert.IsAssignableFrom<IEnumerable<MaterialRequestDto>>(result.Value), r => r.Id == request.Id);

        Assert.Equal(20m, dto.LastUnitPrice);
    }

    [Fact]
    public async Task GeneratedPoLine_KeepsTheEnteredUnitPrice()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);

        Assert.IsType<OkObjectResult>(await ControllerAs(db, admin).GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id,
            ExpectedDate = new DateTime(2026, 12, 1),
            Assignments = [new GeneratePOAssignmentDto { RequestId = request.Id, SupplierName = "Price Test Supplier", UnitPrice = 22.5m }],
        }));

        var line = await db.PurchaseOrderMaterials.AsNoTracking()
            .SingleAsync(m => m.PurchaseOrder.ProjectId == project.Id);
        Assert.Equal(22.5m, line.UnitPrice);
    }

    [Fact]
    public async Task NegativeUnitPrice_IsRejected()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);

        Assert.IsType<BadRequestObjectResult>(await ControllerAs(db, admin).GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id,
            ExpectedDate = new DateTime(2026, 12, 1),
            Assignments = [new GeneratePOAssignmentDto { RequestId = request.Id, SupplierName = "Price Test Supplier", UnitPrice = -1 }],
        }));
    }

    private static async Task<(User, Project, Material, MaterialRequest)> SeedAsync(ConstructIQ.API.Data.AppDbContext db)
    {
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs");
        var request = new MaterialRequest
        {
            ProjectId = project.Id, MaterialId = material.Id, Quantity = 40, Unit = "pcs", RequestedByUserId = admin.Id,
        };
        db.MaterialRequests.Add(request);
        await db.SaveChangesAsync();
        return (admin, project, material, request);
    }

    private static MaterialRequestsController ControllerAs(ConstructIQ.API.Data.AppDbContext db, User user) =>
        new(db, null!)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                        new Claim(ClaimTypes.Role, user.Role.ToString()),
                    ], "Test")),
                },
            },
        };
}
