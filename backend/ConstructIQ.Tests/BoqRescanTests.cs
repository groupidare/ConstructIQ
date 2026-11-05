using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// The screen skips scanned lines already in the plan, but only knows the rows it
// has loaded. A repeated scan must not double a plan whose rows it couldn't see.
[Collection("Database")]
public class BoqRescanTests(DatabaseFixture fixture)
{
    private const string Line = "Concrete Hollow Block 5in, exterior walls";

    private static async Task<(User User, Project Project)> SeedAsync(AppDbContext db)
    {
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        return (user, project);
    }

    private static BOQItemUpsertDto Scanned(string name = Line, decimal quantity = 169) => new()
    {
        PrimarySection = "1. ARCHITECTURAL WORKS", SubCategory = "1.1 Masonry", NewMaterialName = name,
        Unit = "sq.m", EstimatedQuantity = quantity, Notes = "Auto-scanned",
    };

    [Fact]
    public async Task ScanningAgain_KeepsTheRows_AndWhatWasFilledIn()
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var service = new BOQService(db);

        var row = (await service.BulkSaveAsync(project.Id, [Scanned()], user.Id)).Single();
        var onFile = await db.BOQItems.SingleAsync(b => b.Id == row.Id);
        onFile.EstimatedPurchaseQuantity = 5894;
        onFile.EstimatedPurchaseUnit = "pc";
        await db.SaveChangesAsync();

        var again = (await service.BulkSaveAsync(project.Id, [Scanned()], user.Id)).Single();

        Assert.Equal(row.Id, again.Id);
        Assert.Equal(5894, again.EstimatedPurchaseQuantity);
        Assert.Equal(1, await db.BOQItems.CountAsync(b => b.ProjectId == project.Id));
    }

    [Fact]
    public async Task ABoqListingALineTwice_KeepsBoth_EvenScannedAgain()
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var service = new BOQService(db);

        await service.BulkSaveAsync(project.Id, [Scanned(), Scanned()], user.Id);
        Assert.Equal(2, await db.BOQItems.CountAsync(b => b.ProjectId == project.Id));

        await service.BulkSaveAsync(project.Id, [Scanned(), Scanned()], user.Id);
        Assert.Equal(2, await db.BOQItems.CountAsync(b => b.ProjectId == project.Id));
    }

    [Fact]
    public async Task ANewLine_IsStillAdded()
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var service = new BOQService(db);
        await service.BulkSaveAsync(project.Id, [Scanned()], user.Id);

        await service.BulkSaveAsync(project.Id, [Scanned(), Scanned(quantity: 200)], user.Id);

        Assert.Equal(2, await db.BOQItems.CountAsync(b => b.ProjectId == project.Id));
    }

    [Fact] // Only a scan is second-guessed; a person adding a row means it.
    public async Task AManuallyAddedRow_IsAlwaysAdded()
    {
        await using var db = fixture.CreateContext();
        var (user, project) = await SeedAsync(db);
        var service = new BOQService(db);
        await service.BulkSaveAsync(project.Id, [Scanned()], user.Id);

        var manual = Scanned();
        manual.Notes = null;
        await service.BulkSaveAsync(project.Id, [manual], user.Id);

        Assert.Equal(2, await db.BOQItems.CountAsync(b => b.ProjectId == project.Id));
    }
}
