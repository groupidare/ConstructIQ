using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ConstructIQ.Tests;

[Collection("Database")]
public class WarehouseStockLinkTests(DatabaseFixture fixture)
{
    private sealed class NoHttp : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => throw new InvalidOperationException("Links never call the sheet.");
    }

    private static WarehouseStockService Service(AppDbContext db) => new(
        db, new NoHttp(), new ConfigurationBuilder().Build(), NullLogger<WarehouseStockService>.Instance);

    private static async Task ResetAsync(AppDbContext db, decimal balance = 12)
    {
        db.WarehouseStockLinks.RemoveRange(db.WarehouseStockLinks);
        db.WarehouseStockItems.RemoveRange(db.WarehouseStockItems);
        db.WarehouseStockItems.Add(new WarehouseStockItem { MaterialName = "Cementitious Tile Grout, 5kg pack", Unit = "pack", Balance = balance });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Saving_AgainForTheSameWording_UpdatesOneLink()
    {
        await using var db = fixture.CreateContext();
        await ResetAsync(db);
        var service = Service(db);

        await service.SaveLinkAsync("Tile Grout, cement-based", null);
        // Same wording apart from case and spacing; the item's spelling is the sheet's.
        var saved = await service.SaveLinkAsync("  tile  grout, CEMENT-based ", "cementitious tile grout, 5kg PACK");

        var link = Assert.Single(await service.GetLinksAsync());
        Assert.Equal("Cementitious Tile Grout, 5kg pack", saved.WarehouseMaterialName);
        Assert.Equal("Cementitious Tile Grout, 5kg pack", link.WarehouseMaterialName);
    }

    [Fact]
    public async Task Linking_ToAnItemNotOnTheWarehouseList_IsRefused()
    {
        await using var db = fixture.CreateContext();
        await ResetAsync(db);

        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(db).SaveLinkAsync("Tile Grout", "Something Else"));
        Assert.Empty(await Service(db).GetLinksAsync());
    }

    [Fact]
    public async Task NotStocked_IsRememberedAndCanBeRemoved()
    {
        await using var db = fixture.CreateContext();
        await ResetAsync(db);
        var service = Service(db);

        await service.SaveLinkAsync("Stair Railing c/w handrail", null);
        Assert.Null(Assert.Single(await service.GetLinksAsync()).WarehouseMaterialName);

        await service.RemoveLinkAsync("STAIR railing c/w handrail");
        Assert.Empty(await service.GetLinksAsync());
    }

    [Fact] // Saving can merge a row into a differently-named catalog material.
    public async Task WarehouseRequest_ShowsTheItemLinkedToItsBoqWording()
    {
        await using var db = fixture.CreateContext();
        await ResetAsync(db);
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var boq = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 100, "sq.m", 10, "pack");
        boq.Specification = "Tile Grout, cement-based";
        await db.SaveChangesAsync();
        await Service(db).SaveLinkAsync("Tile Grout, cement-based", "Cementitious Tile Grout, 5kg pack");

        var requests = new WarehouseRequestService(db, new NotificationService(db));
        await requests.CreateAsync(new WarehouseRequestCreateDto { ProjectId = project.Id, MaterialId = material.Id, RequestedQuantity = 5 }, user.Id);

        var shown = Assert.Single(await requests.GetByProjectAsync(project.Id));
        Assert.Equal("Cementitious Tile Grout, 5kg pack", shown.LinkedStockName);
        Assert.Equal("pack", shown.LinkedStockUnit);
        Assert.Equal(12, shown.LinkedStockBalance);
    }

    [Fact] // Two rows of one material, linked differently: can't tell which is meant.
    public async Task WarehouseRequest_WithConflictingLinks_ShowsNone()
    {
        await using var db = fixture.CreateContext();
        await ResetAsync(db);
        db.WarehouseStockItems.Add(new WarehouseStockItem { MaterialName = "Other Grout", Unit = "bag", Balance = 3 });
        await db.SaveChangesAsync();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var first = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 100, "sq.m", 10, "pack");
        var second = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 100, "sq.m", 10, "pack");
        first.Specification = "Grout A";
        second.Specification = "Grout B";
        await db.SaveChangesAsync();
        await Service(db).SaveLinkAsync("Grout A", "Cementitious Tile Grout, 5kg pack");
        await Service(db).SaveLinkAsync("Grout B", "Other Grout");

        var requests = new WarehouseRequestService(db, new NotificationService(db));
        await requests.CreateAsync(new WarehouseRequestCreateDto { ProjectId = project.Id, MaterialId = material.Id, RequestedQuantity = 5 }, user.Id);

        Assert.Null(Assert.Single(await requests.GetByProjectAsync(project.Id)).LinkedStockName);
    }
}
