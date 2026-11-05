using System.Security.Claims;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.MaterialRequests;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Requesting a whole Material Plan at once needs every row filled in; a single
// row only needs itself filled in.
[Collection("Database")]
public class BulkRequestTests(DatabaseFixture fixture)
{
    private static WarehouseRequestService Warehouse(AppDbContext db) => new(db, new NotificationService(db));

    private static MaterialRequestsController Procurement(AppDbContext db, User user) =>
        new(db, new NotificationService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                        new Claim(ClaimTypes.Role, nameof(UserRole.Admin)),
                    ], "Test")),
                },
            },
        };

    private static async Task<(User User, Project Project, Material Material, BOQItem Row)> SeedAsync(AppDbContext db, decimal? quantity = 10, string? unit = "pc")
    {
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 100, "sq.m", quantity, unit);
        return (user, project, material, row);
    }

    [Theory]
    [InlineData(null, "pc", "Material Quantity")]
    [InlineData(0, "pc", "Material Quantity")]
    [InlineData(10, null, "Material Unit")]
    public async Task WarehouseRequest_ForARowWithMissingFields_IsRefused(int? quantity, string? unit, string named)
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db, quantity, unit);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, RequestedQuantity = 5,
        }, s.User.Id));

        Assert.Contains(named, error.Message);
        Assert.False(await db.WarehouseRequests.AnyAsync(w => w.ProjectId == s.Project.Id));
    }

    [Fact]
    public async Task ProcurementRequest_ForARowWithNoQuantity_IsRefused()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db, null, null);

        var result = await Procurement(db, s.User).Create(new CreateMaterialRequestDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, Quantity = 5, Unit = "pc",
        });

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.False(await db.MaterialRequests.AnyAsync(m => m.ProjectId == s.Project.Id));
    }

    [Fact]
    public async Task SingleRequests_ForAFilledInRow_GoWhileAnotherRowIsBlank()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        await TestDataBuilder.CreateBoqItemAsync(db, s.Project.Id, s.Material.Id, s.User.Id, 100);

        await Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, RequestedQuantity = 5,
        }, s.User.Id);
        var procurement = await Procurement(db, s.User).Create(new CreateMaterialRequestDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, Quantity = 5, Unit = "pc",
        });

        Assert.IsNotType<BadRequestObjectResult>(procurement);
        Assert.True(await db.WarehouseRequests.AnyAsync(w => w.ProjectId == s.Project.Id));
        Assert.True(await db.MaterialRequests.AnyAsync(m => m.ProjectId == s.Project.Id));
    }

    [Fact] // Not even the filled-in rows go in a bulk send while another is blank.
    public async Task BulkRequests_AreRefused_WhileAnotherRowIsBlank()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        await TestDataBuilder.CreateBoqItemAsync(db, s.Project.Id, s.Material.Id, s.User.Id, 100);

        var bulk = new BulkRequestDto
        {
            ProjectId = s.Project.Id,
            Items = [new() { BOQItemId = s.Row.Id, MaterialId = s.Material.Id, Quantity = 5, Unit = "pc" }],
        };
        var error = Assert.Single(await Warehouse(db).CreateBulkAsync(bulk, s.User.Id)).Error;
        Assert.Contains("1 material is missing", error);
        var viaProcurement = Assert.IsType<OkObjectResult>(await Procurement(db, s.User).CreateBulk(bulk, new ProjectAccessService(db)));
        Assert.False(Assert.Single(Assert.IsType<List<BulkRequestResultDto>>(viaProcurement.Value)).Success);

        Assert.False(await db.WarehouseRequests.AnyAsync(w => w.ProjectId == s.Project.Id));
        Assert.False(await db.MaterialRequests.AnyAsync(m => m.ProjectId == s.Project.Id));
    }

    [Fact] // One row that can't go reports its reason; the others still go.
    public async Task WarehouseBulk_SendsWhatItCan_AndNotifiesOnce()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var pending = await TestDataBuilder.CreateBoqItemAsync(db, s.Project.Id, s.Material.Id, s.User.Id, 100, "sq.m", 8, "pc");
        await Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = pending.Id, RequestedQuantity = 1, Unit = "pc",
        }, s.User.Id);
        var second = await TestDataBuilder.CreateBoqItemAsync(db, s.Project.Id, s.Material.Id, s.User.Id, 50, "sq.m", 5, "pc");
        await TestDataBuilder.CreateUserAsync(db, UserRole.WarehousePersonnel);
        var before = await db.Notifications.CountAsync();

        var results = await Warehouse(db).CreateBulkAsync(new BulkRequestDto
        {
            ProjectId = s.Project.Id,
            Items =
            [
                new() { BOQItemId = s.Row.Id, MaterialId = s.Material.Id, Quantity = 4, Unit = "pc" },
                new() { BOQItemId = pending.Id, MaterialId = s.Material.Id, Quantity = 4, Unit = "pc" },
                new() { BOQItemId = second.Id, MaterialId = s.Material.Id, Quantity = 5, Unit = "pc" },
            ],
        }, s.User.Id);

        Assert.True(results[0].Success);
        Assert.False(results[1].Success);
        Assert.Contains("already pending", results[1].Error);
        Assert.True(results[2].Success);
        Assert.Equal(3, await db.WarehouseRequests.CountAsync(w => w.ProjectId == s.Project.Id));

        var added = await db.Notifications.OrderByDescending(n => n.Id).Take(await db.Notifications.CountAsync() - before).ToListAsync();
        var summary = Assert.Single(added.Select(n => n.Message).Distinct());
        Assert.Contains("2 materials", summary);
    }

    [Fact]
    public async Task ProcurementBulk_SendsWhatItCan_AndTracksEachRow()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var otherProject = await TestDataBuilder.CreateProjectAsync(db, s.User.Id);
        var notThisProjects = await TestDataBuilder.CreateBoqItemAsync(db, otherProject.Id, s.Material.Id, s.User.Id, 100, "sq.m", 8, "pc");

        var result = Assert.IsType<OkObjectResult>(await Procurement(db, s.User).CreateBulk(new BulkRequestDto
        {
            ProjectId = s.Project.Id,
            Items =
            [
                new() { BOQItemId = s.Row.Id, MaterialId = s.Material.Id, Quantity = 4, Unit = "pc" },
                new() { BOQItemId = notThisProjects.Id, MaterialId = s.Material.Id, Quantity = 4, Unit = "pc" },
            ],
        }, new ProjectAccessService(db)));

        var results = Assert.IsType<List<BulkRequestResultDto>>(result.Value);
        Assert.True(results[0].Success);
        Assert.False(results[1].Success);

        var saved = await db.MaterialRequests.SingleAsync(m => m.ProjectId == s.Project.Id);
        Assert.Equal(s.Row.Id, saved.BOQItemId);
        Assert.Equal("pc", saved.Unit);
        Assert.Equal(6, (await ProcurementCapCalculator.GetRowStatusesAsync(db, s.Project.Id))[s.Row.Id].RemainingRequestable);
    }

    [Fact]
    public async Task ProcurementBulk_ByARoleThatCantEditThePlan_IsForbidden()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var engineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var controller = Procurement(db, engineer);
        controller.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, engineer.Id.ToString()),
            new Claim(ClaimTypes.Role, nameof(UserRole.SiteEngineer)),
        ], "Test"));

        var result = await controller.CreateBulk(new BulkRequestDto
        {
            ProjectId = s.Project.Id,
            Items = [new() { BOQItemId = s.Row.Id, MaterialId = s.Material.Id, Quantity = 4, Unit = "pc" }],
        }, new ProjectAccessService(db));

        Assert.IsType<ForbidResult>(result);
        Assert.False(await db.MaterialRequests.AnyAsync(m => m.ProjectId == s.Project.Id));
    }

    [Fact]
    public async Task WarehouseBulk_WithNothingSent_NotifiesNobody()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db, null, null);
        var before = await db.Notifications.CountAsync();

        var results = await Warehouse(db).CreateBulkAsync(new BulkRequestDto
        {
            ProjectId = s.Project.Id,
            Items = [new() { BOQItemId = s.Row.Id, MaterialId = s.Material.Id, Quantity = 4, Unit = "pc" }],
        }, s.User.Id);

        Assert.False(Assert.Single(results).Success);
        Assert.Equal(before, await db.Notifications.CountAsync());
    }

    [Fact]
    public async Task DeletingARow_KeepsItsRequests()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);
        var request = await Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, RequestedQuantity = 4, Unit = "pc",
        }, s.User.Id);

        await using var deleting = fixture.CreateContext();
        Assert.True(await new BOQService(deleting).DeleteAsync(s.Row.Id));

        await using var after = fixture.CreateContext();
        Assert.False(await after.BOQItems.AnyAsync(b => b.Id == s.Row.Id));
        var kept = await after.WarehouseRequests.SingleAsync(w => w.Id == request.Id);
        Assert.Null(kept.BOQItemId);
    }

    [Fact]
    public async Task PendingCheck_IsReportedOnItsRow()
    {
        await using var db = fixture.CreateContext();
        var s = await SeedAsync(db);

        await Warehouse(db).CreateAsync(new WarehouseRequestCreateDto
        {
            ProjectId = s.Project.Id, MaterialId = s.Material.Id, BOQItemId = s.Row.Id, RequestedQuantity = 4, Unit = "pc",
        }, s.User.Id);

        Assert.Equal(4, (await ProcurementCapCalculator.GetRowStatusesAsync(db, s.Project.Id))[s.Row.Id].WarehousePendingQuantity);
    }
}
