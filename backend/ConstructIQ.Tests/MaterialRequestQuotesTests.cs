using System.Security.Claims;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Models.DTOs.MaterialRequests;
using ConstructIQ.API.Models.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Material Request Form: up to three supplier quotes per material, each
// supplier's last price auto-filled, one quote chosen for the PO; and
// sequential PO numbers (PO-001, PO-002, …) with no duplicates.
[Collection("Database")]
public class MaterialRequestQuotesTests(DatabaseFixture fixture)
{
    // ── Quotes ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task SavedQuotesAndRemarks_ComeBackWithTheRequest_AndCanBeEdited()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);
        var controller = ControllerAs(db, admin);

        Assert.IsType<NoContentResult>(await controller.SaveQuotes(project.Id, new SaveRequestQuotesDto
        {
            Requests = [new RequestQuotesDto
            {
                RequestId = request.Id, Remarks = "Urgent — slab pour on Friday",
                Quotes = [Quote(1, "Alpha Hardware", 20), Quote(2, "Beta Supply", 18.5m, selected: true), Quote(3, "Gamma Depot", null)],
            }],
        }));
        // Edit: drop the third quote, change the second's price.
        Assert.IsType<NoContentResult>(await controller.SaveQuotes(project.Id, new SaveRequestQuotesDto
        {
            Requests = [new RequestQuotesDto
            {
                RequestId = request.Id, Remarks = "Urgent — slab pour on Friday",
                Quotes = [Quote(1, "Alpha Hardware", 20), Quote(2, "Beta Supply", 17, selected: true)],
            }],
        }));

        var dto = await GetRequestAsync(fixture, admin, project.Id, request.Id);
        Assert.Equal("Urgent — slab pour on Friday", dto.Remarks);
        Assert.Collection(dto.Quotes,
            q => Assert.Equal(("Alpha Hardware", 20m, false), (q.SupplierName, q.UnitPrice!.Value, q.IsSelected)),
            q => Assert.Equal(("Beta Supply", 17m, true), (q.SupplierName, q.UnitPrice!.Value, q.IsSelected)));
    }

    [Theory]
    [InlineData("four")]
    [InlineData("duplicate")]
    [InlineData("negative")]
    [InlineData("two-selected")]
    public async Task InvalidQuotes_AreRejected(string problem)
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);
        List<MaterialRequestQuoteDto> quotes = problem switch
        {
            "four"         => [Quote(1, "A", 1), Quote(2, "B", 1), Quote(3, "C", 1), Quote(4, "D", 1)],
            "duplicate"    => [Quote(1, "Alpha", 1), Quote(2, " alpha ", 2)],
            "negative"     => [Quote(1, "Alpha", -5)],
            _              => [Quote(1, "Alpha", 1, selected: true), Quote(2, "Beta", 2, selected: true)],
        };

        Assert.IsType<BadRequestObjectResult>(await ControllerAs(db, admin).SaveQuotes(project.Id, new SaveRequestQuotesDto
        {
            Requests = [new RequestQuotesDto { RequestId = request.Id, Quotes = quotes }],
        }));
    }

    [Fact]
    public async Task GeneratePo_UsesTheSelectedQuote_AndKeepsTheComparison()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);
        List<MaterialRequestQuoteDto> quotes = [Quote(1, "Alpha Hardware", 20), Quote(2, "Beta Supply", 18.5m, selected: true)];

        Assert.IsType<OkObjectResult>(await ControllerAs(db, admin).GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id, ExpectedDate = new DateTime(2026, 12, 1),
            Assignments = [new GeneratePOAssignmentDto
            {
                RequestId = request.Id, SupplierName = "Beta Supply", UnitPrice = 18.5m, Quotes = quotes, Remarks = "Deliver to gate 2",
            }],
        }));

        await using var verify = fixture.CreateContext();
        var po = await verify.PurchaseOrders.Include(p => p.Supplier).Include(p => p.Materials)
            .SingleAsync(p => p.ProjectId == project.Id);
        Assert.Equal("Beta Supply", po.Supplier.Name);
        Assert.Equal(18.5m, Assert.Single(po.Materials).UnitPrice);
        Assert.NotNull(PoNumberGenerator.Parse(po.Number));

        var stored = await verify.MaterialRequests.Include(r => r.Quotes).SingleAsync(r => r.Id == request.Id);
        Assert.Equal(po.Id, stored.FulfilledByPurchaseOrderId);
        Assert.Equal("Deliver to gate 2", stored.Remarks);
        Assert.Equal(2, stored.Quotes.Count);
        Assert.Equal("Beta Supply", Assert.Single(stored.Quotes, q => q.IsSelected).SupplierName);
    }

    [Fact]
    public async Task GeneratePo_RejectsQuotesWithNoSupplierChosen_OrAMismatchedChoice()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);
        var controller = ControllerAs(db, admin);

        Assert.IsType<BadRequestObjectResult>(await controller.GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id, ExpectedDate = new DateTime(2026, 12, 1),
            Assignments = [new GeneratePOAssignmentDto
            {
                RequestId = request.Id, SupplierName = "Alpha", UnitPrice = 10, Quotes = [Quote(1, "Alpha", 10), Quote(2, "Beta", 9)],
            }],
        }));
        Assert.IsType<BadRequestObjectResult>(await controller.GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id, ExpectedDate = new DateTime(2026, 12, 1),
            Assignments = [new GeneratePOAssignmentDto
            {
                RequestId = request.Id, SupplierName = "Alpha", UnitPrice = 10, Quotes = [Quote(1, "Alpha", 10), Quote(2, "Beta", 9, selected: true)],
            }],
        }));
        Assert.False(await db.PurchaseOrders.AnyAsync(p => p.ProjectId == project.Id));
    }

    [Fact]
    public async Task SuggestedSuppliers_CarryEachSuppliersOwnLastPrice_InTheRequestedUnit()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, _) = await SeedAsync(db);
        var alpha = await AddPricedPoAsync(db, project.Id, admin.Id, material.Id, "Alpha " + Guid.NewGuid().ToString("N")[..6], "pcs", 18, new DateTime(2025, 1, 1));
        await AddPricedPoAsync(db, project.Id, admin.Id, material.Id, alpha.Name, "pieces", 21, new DateTime(2026, 2, 1));
        await AddPricedPoAsync(db, project.Id, admin.Id, material.Id, alpha.Name, "box", 300, new DateTime(2026, 5, 1));
        var beta = await AddPricedPoAsync(db, project.Id, admin.Id, material.Id, "Beta " + Guid.NewGuid().ToString("N")[..6], "pcs", 19, new DateTime(2026, 3, 1));

        var ok = Assert.IsType<OkObjectResult>(await ControllerAs(db, admin).GetSuggestedSuppliers(material.Id, "pcs"));
        var list = Assert.IsAssignableFrom<IEnumerable<SuggestedSupplierDto>>(ok.Value).ToList();

        // Alpha's newest pcs/pieces price (the box price is another unit).
        Assert.Equal(21m, list.Single(s => s.Id == alpha.Id).LastUnitPrice);
        Assert.Equal(19m, list.Single(s => s.Id == beta.Id).LastUnitPrice);
        Assert.All(list.Where(s => s.Id != alpha.Id && s.Id != beta.Id && !s.HasHistoryWithMaterial), s => Assert.Null(s.LastUnitPrice));
    }

    // ── PO numbering ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(1, "PO-001")]
    [InlineData(42, "PO-042")]
    [InlineData(999, "PO-999")]
    [InlineData(1000, "PO-1000")]
    public void PoNumbers_AreZeroPaddedToThreeDigits(int n, string expected)
    {
        Assert.Equal(expected, PoNumberGenerator.Format(n));
        Assert.Equal(n, PoNumberGenerator.Parse(expected));
    }

    [Theory]
    [InlineData("PO-2026-4821")]
    [InlineData("PO-1234567890")]
    [InlineData("ABC-001")]
    public void OtherNumberFormats_AreNotPartOfTheSequence(string number) =>
        Assert.Null(PoNumberGenerator.Parse(number));

    [Fact]
    public async Task NextNumber_FollowsTheHigherOfLastSequentialAndTotalCount()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, _) = await SeedAsync(db);

        var next = await PoNumberGenerator.NextAsync(db);
        var count = await db.PurchaseOrders.CountAsync();
        Assert.True(next > count, "The next number must be past every PO already issued.");

        var po = NewPo(project.Id, admin.Id, material.Id);
        db.PurchaseOrders.Add(po);
        await PoNumberGenerator.SaveWithNumbersAsync(db, [po]);

        Assert.Equal(PoNumberGenerator.Format(next), po.Number);
        Assert.Equal(next + 1, await PoNumberGenerator.NextAsync(db));
    }

    [Fact]
    public async Task PosCreatedAtTheSameTime_GetDistinctConsecutiveNumbers()
    {
        await using var seedDb = fixture.CreateContext();
        var (admin, project, material, _) = await SeedAsync(seedDb);

        async Task<string> CreateOne()
        {
            await using var db = fixture.CreateContext();
            var po = NewPo(project.Id, admin.Id, material.Id);
            db.PurchaseOrders.Add(po);
            await PoNumberGenerator.SaveWithNumbersAsync(db, [po]);
            return po.Number;
        }

        var numbers = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => CreateOne()));

        Assert.Equal(4, numbers.Distinct().Count());
        Assert.All(numbers, n => Assert.NotNull(PoNumberGenerator.Parse(n)));
    }

    [Fact]
    public async Task GeneratePos_ForTwoSuppliers_GetsTwoConsecutiveNumbers()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, first) = await SeedAsync(db);
        var second = new MaterialRequest { ProjectId = project.Id, MaterialId = material.Id, Quantity = 5, Unit = "pcs", RequestedByUserId = admin.Id };
        db.MaterialRequests.Add(second);
        await db.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>(await ControllerAs(db, admin).GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id, ExpectedDate = new DateTime(2026, 12, 1),
            Assignments =
            [
                new GeneratePOAssignmentDto { RequestId = first.Id, SupplierName = "Seq Supplier A", UnitPrice = 1 },
                new GeneratePOAssignmentDto { RequestId = second.Id, SupplierName = "Seq Supplier B", UnitPrice = 1 },
            ],
        }));

        var result = Assert.IsType<GeneratedPOsResultDto>(ok.Value);
        var numbers = result.RequestPoNumbers.Values.Select(n => PoNumberGenerator.Parse(n)!.Value).OrderBy(n => n).ToList();
        Assert.Equal(numbers[0] + 1, numbers[1]);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static MaterialRequestQuoteDto Quote(int slot, string supplier, decimal? price, bool selected = false) =>
        new() { Slot = slot, SupplierName = supplier, UnitPrice = price, IsSelected = selected };

    private static async Task<MaterialRequestDto> GetRequestAsync(DatabaseFixture fixture, User user, int projectId, int requestId)
    {
        await using var db = fixture.CreateContext();
        var ok = Assert.IsType<OkObjectResult>(await ControllerAs(db, user).GetForProject(projectId));
        return Assert.Single(Assert.IsAssignableFrom<IEnumerable<MaterialRequestDto>>(ok.Value), r => r.Id == requestId);
    }

    private static PurchaseOrder NewPo(int projectId, int userId, int materialId)
    {
        var supplier = new Supplier { Name = "Seq " + Guid.NewGuid().ToString("N")[..10] };
        return new PurchaseOrder
        {
            ProjectId = projectId, Supplier = supplier, ExpectedDate = DateTime.UtcNow, CreatedByUserId = userId,
            Materials = [new PurchaseOrderMaterial { Name = "line", Quantity = 1, Unit = "pcs", MaterialId = materialId }],
        };
    }

    private static async Task<Supplier> AddPricedPoAsync(ConstructIQ.API.Data.AppDbContext db, int projectId, int userId,
        int materialId, string supplierName, string unit, decimal price, DateTime orderDate)
    {
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Name == supplierName) ?? new Supplier { Name = supplierName };
        db.PurchaseOrders.Add(new PurchaseOrder
        {
            Number = "T-" + Guid.NewGuid().ToString("N")[..12], ProjectId = projectId, Supplier = supplier,
            OrderDate = orderDate, ExpectedDate = orderDate, CreatedByUserId = userId,
            Materials = [new PurchaseOrderMaterial { Name = "line", Quantity = 1, Unit = unit, MaterialId = materialId, UnitPrice = price }],
        });
        await db.SaveChangesAsync();
        return supplier;
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
