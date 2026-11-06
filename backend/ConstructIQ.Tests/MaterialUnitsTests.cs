using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Material Unit means how a material is bought (length, sack, sheet…), never a
// measure of the work; and one product written two ways is one catalog material.
public class MaterialNamesTests
{
    [Theory]
    [InlineData("Steel Sheet, 0.50mm thick", "steel sheet, 0.5mm thick")]
    [InlineData("  STEEL   sheet, 0.5 mm thick ", "steel sheet, 0.5mm thick")]
    [InlineData("Pipe, .5m", "pipe, 0.5m")]
    [InlineData("Board 12.0mm x 1.20m", "board 12mm x 1.2m")]
    [InlineData("CHB 100mm", "chb 100mm")]
    [InlineData("Gutter 0.05mm", "gutter 0.05mm")]
    [InlineData("Wire 10.5mm", "wire 10.5mm")]
    public void Canonical(string name, string expected) => Assert.Equal(expected, MaterialNames.Canonical(name));

    [Fact]
    public void DifferentSizesStayDifferent() =>
        Assert.NotEqual(MaterialNames.Canonical("Sheet, 0.5mm"), MaterialNames.Canonical("Sheet, 0.6mm"));
}

[Collection("Database")]
public class MaterialUnitsTests(DatabaseFixture fixture)
{
    private static string Unique() => Guid.NewGuid().ToString("N")[..10];

    private static BOQItemUpsertDto Row(string name) => new()
    {
        PrimarySection = "Architectural Works", SubCategory = "Roof", NewMaterialName = name, Unit = "sq.m", EstimatedQuantity = 10,
    };

    private static async Task<(User User, Project Project)> SeedAsync(AppDbContext db)
    {
        var user = await TestDataBuilder.CreateUserAsync(db);
        return (user, await TestDataBuilder.CreateProjectAsync(db, user.Id));
    }

    private static async Task<Material> MaterialAsync(AppDbContext db, string unit, string? name = null)
    {
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: unit);
        material.UnitCost = 0;
        if (name is not null) material.Name = name;
        await db.SaveChangesAsync();
        return material;
    }

    private static async Task PastPurchaseAsync(AppDbContext db, User user, int materialId, string unit, decimal price, string? name = null)
    {
        var past = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        past.IsHistorical = true;
        var row = await TestDataBuilder.CreateBoqItemAsync(db, past.Id, materialId, user.Id, 10);
        row.PrimarySection = "Architectural Works";
        db.HistoricalMaterialSupplies.Add(new HistoricalMaterialSupply
        {
            BOQItemId = row.Id, MaterialName = name ?? "Past line", Unit = unit, Quantity = 12, UnitCost = price,
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task MergingADuplicateMaterial_MovesItsRows_GivesThemThePastPrice_AndDeactivatesIt()
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var family = Unique();
        var kept = await MaterialAsync(db, "sq.m", $"Sheet {family}, 0.5mm thick");
        var duplicate = await MaterialAsync(db, "sq.m", $"Sheet {family}, 0.50mm thick");
        var other = await MaterialAsync(db, "sq.m", $"Sheet {family}, 0.6mm thick");
        await PastPurchaseAsync(db, user, kept.Id, "sheet", 2100);
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, duplicate.Id, user.Id, 328, unit: "sq.m",
            estimatedPurchaseQuantity: 110, estimatedPurchaseUnit: "sheet");
        var otherRow = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, other.Id, user.Id, 5, unit: "sq.m");

        // Both projects hold the kept material's stock record already / only the duplicate's.
        var bothProject = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var keptStock = new InventoryRecord { ProjectId = bothProject.Id, MaterialId = kept.Id };
        var dupStock = new InventoryRecord { ProjectId = bothProject.Id, MaterialId = duplicate.Id };
        var movedStock = new InventoryRecord { ProjectId = project.Id, MaterialId = duplicate.Id };
        db.InventoryRecords.AddRange(keptStock, dupStock, movedStock);
        await db.SaveChangesAsync();

        foreach (var sql in ConstructIQ.API.Migrations.MergeDuplicateLongspanMaterial.MergeSql(duplicate.Name, kept.Name))
            await db.Database.ExecuteSqlRawAsync(sql);

        await using var verify = fixture.CreateContext();
        Assert.Equal(kept.Id, (await verify.BOQItems.FindAsync(row.Id))!.MaterialId);
        Assert.Equal(other.Id, (await verify.BOQItems.FindAsync(otherRow.Id))!.MaterialId);
        Assert.Equal(kept.Id, (await verify.InventoryRecords.FindAsync(movedStock.Id))!.MaterialId);
        Assert.Equal(duplicate.Id, (await verify.InventoryRecords.FindAsync(dupStock.Id))!.MaterialId); // would break uniqueness
        Assert.False((await verify.Materials.FindAsync(duplicate.Id))!.IsActive);
        Assert.True((await verify.Materials.FindAsync(kept.Id))!.IsActive);
        Assert.True((await verify.Materials.FindAsync(other.Id))!.IsActive);

        var line = (await new MaterialCostService(verify).GetEstimatedMaterialCostAsync(project.Id))!.Lines.Single(l => l.BOQItemId == row.Id);
        Assert.Equal(2100m, line.UnitPrice);
        Assert.Equal(110 * 2100m, line.RemainingCost);
    }

    [Fact]
    public async Task MergingAMaterialThatIsNotThere_ChangesNothing()
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var material = await MaterialAsync(db, "sq.m", $"Sheet {Unique()}, 0.50mm thick");
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 10, unit: "sq.m");

        foreach (var sql in ConstructIQ.API.Migrations.MergeDuplicateLongspanMaterial.MergeSql(material.Name, $"No such material {Unique()}"))
            await db.Database.ExecuteSqlRawAsync(sql);

        await using var verify = fixture.CreateContext();
        Assert.Equal(material.Id, (await verify.BOQItems.FindAsync(row.Id))!.MaterialId);
        Assert.True((await verify.Materials.FindAsync(material.Id))!.IsActive);
    }

    [Fact]
    public async Task Saving_050mm_LinksToTheExisting_05mmMaterial_NotANewOne()
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var family = Unique();
        var existing = await MaterialAsync(db, "sq.m", $"Longspan {family} Steel Sheet, 0.5mm thick");

        var saved = await new BOQService(db).BulkSaveAsync(project.Id,
            [Row($"Longspan {family} Steel Sheet, 0.50mm thick"), Row($"Longspan {family} Steel Sheet, 0.6mm thick")], user.Id);

        var rows = saved.ToList();
        Assert.Equal(existing.Id, rows[0].MaterialId);
        Assert.NotEqual(existing.Id, rows[1].MaterialId); // a real size difference stays its own material
    }

    [Theory]
    [InlineData("length", 1337)]
    [InlineData("sack", 80)]
    public async Task BoughtByTheLengthOrSack_FindsThePastPrice(string unit, decimal price)
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var material = await MaterialAsync(db, "l.m");
        await PastPurchaseAsync(db, user, material.Id, unit, price);
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, 68, unit: "l.m",
            estimatedPurchaseQuantity: 23, estimatedPurchaseUnit: unit);

        var cost = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);

        var line = Assert.Single(cost!.Lines);
        Assert.Equal(price, line.UnitPrice);
        Assert.False(line.NeedsPrice);
    }

    [Fact]
    public async Task HistoricalEstimate_UsesLengthLines_NotMeasureLines()
    {
        await using var db = fixture.CreateContext();
        var (user, _) = await SeedAsync(db);
        var family = Unique();
        var material = await MaterialAsync(db, "l.m");
        await PastPurchaseAsync(db, user, material.Id, "length", 1337, $"Box Gutter {family}");
        await PastPurchaseAsync(db, user, material.Id, "l.m", 400, $"Box Gutter {family}");

        var estimate = await new BOQService(db).GetHistoricalEstimateAsync("Architectural Works", $"Box Gutter {family}", null);

        Assert.Equal("length", estimate.Unit);
        Assert.Equal(1, estimate.MatchCount);
    }
}
