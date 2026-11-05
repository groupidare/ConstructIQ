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
    public async Task SaveRequest_SendsOnlyPricedMaterialsForApproval_AndAPoNeedsThatFirst()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, _) = await SeedAsync(db);
        var priced = new MaterialRequest { ProjectId = project.Id, MaterialId = material.Id, Quantity = 4, Unit = "pcs", RequestedByUserId = admin.Id };
        var unpriced = new MaterialRequest { ProjectId = project.Id, MaterialId = material.Id, Quantity = 2, Unit = "pcs", RequestedByUserId = admin.Id };
        db.MaterialRequests.AddRange(priced, unpriced);
        await db.SaveChangesAsync();
        var controller = ControllerAs(db, admin);
        var generate = () => controller.GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id,
            ExpectedDate = new DateTime(2026, 12, 1),
            Assignments = [new GeneratePOAssignmentDto { RequestId = priced.Id, SupplierName = "Alpha", UnitPrice = 10, Quotes = [Quote(1, "Alpha", 10, selected: true)] }],
        });

        // Not saved yet — no PO.
        Assert.IsType<BadRequestObjectResult>(await generate());

        Assert.IsType<NoContentResult>(await controller.SaveQuotes(project.Id, new SaveRequestQuotesDto
        {
            Submit = true,
            Requests =
            [
                new RequestQuotesDto { RequestId = priced.Id, Quotes = [Quote(1, "Alpha", 10), Quote(2, "Beta", 12)] },
                new RequestQuotesDto { RequestId = unpriced.Id, Quotes = [new MaterialRequestQuoteDto { Slot = 1, SupplierName = "Alpha" }] },
            ],
        }));

        await using (var verify = fixture.CreateContext())
        {
            Assert.NotNull((await verify.MaterialRequests.FindAsync(priced.Id))!.SubmittedForApprovalAt);
            // Kept as typed, but not for approval until it has a price.
            var draft = await verify.MaterialRequests.Include(r => r.Quotes).SingleAsync(r => r.Id == unpriced.Id);
            Assert.Null(draft.SubmittedForApprovalAt);
            Assert.Equal("Alpha", Assert.Single(draft.Quotes).SupplierName);
        }

        Assert.IsType<OkObjectResult>(await generate());
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

    [Fact]
    public async Task SuggestedSuppliers_IncludeHistoricalProjectPoLines_AtTheirLatestPoDate()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, _) = await SeedAsync(db);
        var alpha = await AddPricedPoAsync(db, project.Id, admin.Id, material.Id, "Alpha " + Guid.NewGuid().ToString("N")[..6], "pcs", 18, new DateTime(2025, 1, 1));
        var gamma = new Supplier { Name = "Gamma " + Guid.NewGuid().ToString("N")[..6] };
        db.Suppliers.Add(gamma);
        await db.SaveChangesAsync();
        var historical = await TestDataBuilder.CreateProjectAsync(db, admin.Id, isHistorical: true, targetEndDate: new DateTime(2026, 9, 30));
        var row = await TestDataBuilder.CreateBoqItemAsync(db, historical.Id, material.Id, admin.Id, 1);
        // Alpha again on a historical project's newer PO, and Gamma only there.
        foreach (var (supplier, cost, date) in new[] { (alpha.Id, 17m, new DateTime(2026, 2, 9)), (gamma.Id, 16m, new DateTime(2026, 2, 16)) })
        {
            var line = await TestDataBuilder.CreateHistoricalSupplyAsync(db, row.Id, 10, "pcs", unitCost: cost);
            line.SupplierId = supplier;
            line.PoDate = date;
        }
        await db.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>(await ControllerAs(db, admin).GetSuggestedSuppliers(material.Id, "pcs"));
        var list = Assert.IsAssignableFrom<IEnumerable<SuggestedSupplierDto>>(ok.Value).ToList();

        Assert.Equal(17m, list.Single(s => s.Id == alpha.Id).LastUnitPrice);
        var g = list.Single(s => s.Id == gamma.Id);
        Assert.True(g.HasHistoryWithMaterial);
        Assert.Equal(16m, g.LastUnitPrice);
        Assert.Equal(new DateTime(2026, 2, 16), g.LastPriceDate);
    }

    // ── Edit quantity / delete / default delivery date ──────────────────────

    [Fact]
    public async Task EditedQuantity_IsSaved_AndUsedOnThePo()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);
        var controller = ControllerAs(db, admin);

        Assert.IsType<NoContentResult>(await controller.SaveQuotes(project.Id, new SaveRequestQuotesDto
        {
            Requests = [new RequestQuotesDto { RequestId = request.Id, Quantity = 55 }],
        }));
        Assert.Equal(55m, (await GetRequestAsync(fixture, admin, project.Id, request.Id)).Quantity);

        Assert.IsType<OkObjectResult>(await controller.GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id,
            Assignments = [new GeneratePOAssignmentDto { RequestId = request.Id, SupplierName = "Qty Supplier", UnitPrice = 1, Quantity = 60 }],
        }));
        await using var verify = fixture.CreateContext();
        Assert.Equal(60m, (await verify.PurchaseOrderMaterials.SingleAsync(m => m.PurchaseOrder.ProjectId == project.Id)).Quantity);
    }

    [Fact]
    public async Task ZeroQuantity_IsRejected()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, _, request) = await SeedAsync(db);

        Assert.IsType<BadRequestObjectResult>(await ControllerAs(db, admin).SaveQuotes(project.Id, new SaveRequestQuotesDto
        {
            Requests = [new RequestQuotesDto { RequestId = request.Id, Quantity = 0 }],
        }));
    }

    [Fact]
    public async Task PendingRequest_CanBeDeleted_WithItsQuotes_ButNotOnceOnAPo()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, request) = await SeedAsync(db);
        var controller = ControllerAs(db, admin);
        await controller.SaveQuotes(project.Id, new SaveRequestQuotesDto
        {
            Requests = [new RequestQuotesDto { RequestId = request.Id, Quotes = [Quote(1, "Del Supplier", 5)] }],
        });

        Assert.IsType<NoContentResult>(await controller.Delete(request.Id));
        await using (var verify = fixture.CreateContext())
        {
            Assert.False(await verify.MaterialRequests.AnyAsync(r => r.Id == request.Id));
            Assert.False(await verify.MaterialRequestQuotes.AnyAsync(q => q.MaterialRequestId == request.Id));
        }

        var ordered = new MaterialRequest { ProjectId = project.Id, MaterialId = material.Id, Quantity = 3, Unit = "pcs", RequestedByUserId = admin.Id, SubmittedForApprovalAt = DateTime.UtcNow };
        db.MaterialRequests.Add(ordered);
        await db.SaveChangesAsync();
        await controller.GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id,
            Assignments = [new GeneratePOAssignmentDto { RequestId = ordered.Id, SupplierName = "Del Supplier", UnitPrice = 5 }],
        });
        Assert.IsType<BadRequestObjectResult>(await controller.Delete(ordered.Id));
        Assert.IsType<NotFoundObjectResult>(await controller.Delete(int.MaxValue));
    }

    [Fact]
    public async Task ExpectedDelivery_DefaultsToTheSuppliersAverageLeadTime_ElseSevenDays()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material, request) = await SeedAsync(db);
        var supplier = await AddPricedPoAsync(db, project.Id, admin.Id, material.Id, "Lead " + Guid.NewGuid().ToString("N")[..6], "pcs", 1, DateTime.UtcNow);
        foreach (var days in new[] { 3, 6 })  // average 4.5 → rounds up to 5
        {
            var po = new PurchaseOrder
            {
                Number = "T-" + Guid.NewGuid().ToString("N")[..12], ProjectId = project.Id, SupplierId = supplier.Id,
                ExpectedDate = DateTime.UtcNow, CreatedByUserId = admin.Id,
                Evaluation = new DeliveryEvaluation { ActualLeadDays = days, OnTime = true, RatedByUserId = admin.Id },
            };
            db.PurchaseOrders.Add(po);
        }
        var second = new MaterialRequest { ProjectId = project.Id, MaterialId = material.Id, Quantity = 2, Unit = "pcs", RequestedByUserId = admin.Id, SubmittedForApprovalAt = DateTime.UtcNow };
        db.MaterialRequests.Add(second);
        await db.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>(await ControllerAs(db, admin).GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id,
            Assignments =
            [
                new GeneratePOAssignmentDto { RequestId = request.Id, SupplierName = supplier.Name, UnitPrice = 1 },
                new GeneratePOAssignmentDto { RequestId = second.Id, SupplierName = "Brand New " + Guid.NewGuid().ToString("N")[..6], UnitPrice = 1 },
            ],
        }));

        var numbers = Assert.IsType<GeneratedPOsResultDto>(ok.Value).RequestPoNumbers;
        await using var verify = fixture.CreateContext();
        var known = await verify.PurchaseOrders.SingleAsync(p => p.Number == numbers[request.Id]);
        var brandNew = await verify.PurchaseOrders.SingleAsync(p => p.Number == numbers[second.Id]);
        Assert.Equal(DateTime.UtcNow.Date.AddDays(5), known.ExpectedDate.Date);
        Assert.Equal(DateTime.UtcNow.Date.AddDays(MaterialRequestsController.DefaultLeadDays), brandNew.ExpectedDate.Date);
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
        var second = new MaterialRequest { ProjectId = project.Id, MaterialId = material.Id, Quantity = 5, Unit = "pcs", RequestedByUserId = admin.Id, SubmittedForApprovalAt = DateTime.UtcNow };
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
            ProjectId = project.Id, MaterialId = material.Id, Quantity = 40, Unit = "pcs", RequestedByUserId = admin.Id, SubmittedForApprovalAt = DateTime.UtcNow,
        };
        db.MaterialRequests.Add(request);
        await db.SaveChangesAsync();
        return (admin, project, material, request);
    }

    [Theory]
    [InlineData(20, 500, true)]
    [InlineData(20, 10, false)]
    public async Task Request_IsAdditional_OnlyPastAPurchaseEstimate(int purchaseEstimate, int quantity, bool expected)
    {
        await using var db = fixture.CreateContext();
        var user = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, user.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db);
        var row = await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, user.Id, estimatedQuantity: 169,
            estimatedPurchaseQuantity: purchaseEstimate, estimatedPurchaseUnit: "pc");

        var result = Assert.IsType<OkObjectResult>(await ControllerAs(db, user, new ConstructIQ.API.Services.NotificationService(db)).Create(new CreateMaterialRequestDto
        {
            ProjectId = project.Id, MaterialId = material.Id, Quantity = quantity, Unit = "pc", BOQItemId = row.Id,
        }));

        Assert.Equal(expected, result.Value!.GetType().GetProperty("isAdditional")!.GetValue(result.Value));
    }

    private static MaterialRequestsController ControllerAs(ConstructIQ.API.Data.AppDbContext db, User user, ConstructIQ.API.Services.Interfaces.INotificationService? notifications = null) =>
        new(db, notifications!)
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
