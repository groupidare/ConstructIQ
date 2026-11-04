using System.Security.Claims;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.MaterialRequests;
using ConstructIQ.API.Models.DTOs.Notification;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Supplier quotations as a price source, and "Request quotation": price
// checks sent to Procurement for materials with no recorded price.
[Collection("Database")]
public class QuotationPriceTests(DatabaseFixture fixture)
{
    private sealed class RecordingNotifications : INotificationService
    {
        public List<(UserRole Role, string Message)> Sent { get; } = [];
        public Task CreateForRoleAsync(UserRole recipientRole, NotificationKind kind, string message, int createdByUserId,
            int? projectId = null, int? materialId = null, decimal? quantity = null, string? title = null, string? actionLink = null)
        {
            Sent.Add((recipientRole, message));
            return Task.CompletedTask;
        }
        public Task<NotificationResponseDto> CreateAsync(NotificationCreateDto dto, int userId) => throw new NotSupportedException();
        public Task<IEnumerable<NotificationResponseDto>> GetMineAsync(int userId, string role) => throw new NotSupportedException();
        public Task<bool> MarkReadAsync(int id, int userId) => throw new NotSupportedException();
    }

    // ── Quotation as a price source ─────────────────────────────────────────

    [Fact]
    public async Task Quotation_PricesAMaterialWithNoPo_ChosenQuoteElseLowest()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "gal");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 1, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "gal");

        var request = await AddRequestAsync(db, project.Id, material.Id, admin.Id, "gal",
            ("MetroTile", 520m, false, false), ("Laguna", 480m, false, false));
        var line = Assert.Single((await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id))!.Lines);
        Assert.Equal(480m, line.UnitPrice);
        Assert.Equal("Supplier quotation", line.PriceSource);
        Assert.Equal("Laguna", line.PriceReference);
        Assert.Equal(4800m, line.RemainingCost);
        Assert.False(line.NeedsPrice);

        // Picking a supplier on the form makes that quote the price.
        (await db.MaterialRequestQuotes.SingleAsync(q => q.MaterialRequestId == request.Id && q.SupplierName == "MetroTile")).IsSelected = true;
        await db.SaveChangesAsync();
        line = Assert.Single((await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id))!.Lines);
        Assert.Equal(520m, line.UnitPrice);
    }

    [Fact]
    public async Task Quotation_PriceFilledFromAPastPo_IsNotAQuotation()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "gal");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 1, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "gal");
        await AddRequestAsync(db, project.Id, material.Id, admin.Id, "gal", ("MetroTile", 520m, false, true));

        var line = Assert.Single((await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id))!.Lines);
        Assert.True(line.NeedsPrice);
    }

    [Fact]
    public async Task PoPrice_StillWinsOverAQuotation()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "gal");
        var other = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 1, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "gal");
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, other.Id, admin.Id, material.Id, 1, unit: "gal", unitPrice: 500);
        await AddRequestAsync(db, project.Id, material.Id, admin.Id, "gal", ("Laguna", 480m, false, false));

        var line = Assert.Single((await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id))!.Lines);
        Assert.Equal(500m, line.UnitPrice);
        Assert.Equal("Purchase order", line.PriceSource);
    }

    // ── Request quotation ───────────────────────────────────────────────────

    [Fact]
    public async Task RequestQuotations_SendsEachUnpricedMaterialOnce_AsAPriceCheck()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, unpriced) = await SeedAsync(db, "gal");
        var priced = await TestDataBuilder.CreateMaterialAsync(db, unit: "pcs"); // catalog price 10
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, unpriced.Id, admin.Id, 1, estimatedPurchaseQuantity: 67, estimatedPurchaseUnit: "gal");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, priced.Id, admin.Id, 1, estimatedPurchaseQuantity: 5, estimatedPurchaseUnit: "pcs");
        var notifications = new RecordingNotifications();

        var first = Assert.IsType<PriceInquiryResultDto>(Assert.IsType<OkObjectResult>(await RequestAs(db, admin, project.Id, notifications)).Value);
        var second = Assert.IsType<PriceInquiryResultDto>(Assert.IsType<OkObjectResult>(await RequestAs(db, admin, project.Id, notifications)).Value);

        Assert.Equal(1, first.Requested);
        Assert.Equal(0, second.Requested);
        Assert.Equal(1, second.AlreadyRequested);
        var inquiry = await db.MaterialRequests.SingleAsync(r => r.ProjectId == project.Id);
        Assert.True(inquiry.IsPriceInquiry);
        Assert.Equal(unpriced.Id, inquiry.MaterialId);
        Assert.Equal(67m, inquiry.Quantity);
        Assert.Equal("gal", inquiry.Unit);
        Assert.Equal(UserRole.ProcurementOfficer, Assert.Single(notifications.Sent).Role);

        var line = (await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id))!.Lines.Single(l => l.Unit == "gal");
        Assert.True(line.QuotationRequested);
    }

    [Fact]
    public async Task PriceCheck_DoesNotUseUpTheRequestableBalance_AndCantBecomeAPo()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "gal");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 1, estimatedPurchaseQuantity: 67, estimatedPurchaseUnit: "gal");
        var before = await ProcurementCapCalculator.GetRemainingRequestableAsync(db, project.Id, material.Id);
        await RequestAs(db, admin, project.Id, new RecordingNotifications());
        var inquiry = await db.MaterialRequests.SingleAsync(r => r.ProjectId == project.Id);

        Assert.Equal(before, await ProcurementCapCalculator.GetRemainingRequestableAsync(db, project.Id, material.Id));

        var generate = await ControllerAs(db, admin, new RecordingNotifications()).GeneratePOs(new GeneratePOsFromRequestsDto
        {
            ProjectId = project.Id,
            Assignments = [new GeneratePOAssignmentDto { RequestId = inquiry.Id, SupplierName = "Laguna", UnitPrice = 480 }],
        });
        Assert.IsType<BadRequestObjectResult>(generate);
        Assert.False(await db.PurchaseOrders.AnyAsync(p => p.ProjectId == project.Id));
    }

    [Fact]
    public async Task PriceCheck_LeavesTheRequestsTabOnceAPriceIsSaved_AndPricesTheEstimate()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "gal");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 1, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "gal");
        await RequestAs(db, admin, project.Id, new RecordingNotifications());
        var inquiry = await db.MaterialRequests.SingleAsync(r => r.ProjectId == project.Id);
        var controller = ControllerAs(db, admin, new RecordingNotifications());

        var listed = Assert.Single(Requests(await controller.GetForProject(project.Id)));
        Assert.True(listed.IsPriceInquiry);

        // A supplier typed without a price yet: still waiting.
        await controller.SaveQuotes(project.Id, Save(inquiry.Id, new MaterialRequestQuoteDto { Slot = 1, SupplierName = "Laguna" }));
        Assert.Single(Requests(await controller.GetForProject(project.Id)));

        await controller.SaveQuotes(project.Id, Save(inquiry.Id, new MaterialRequestQuoteDto { Slot = 1, SupplierName = "Laguna", UnitPrice = 480 }));
        Assert.Empty(Requests(await controller.GetForProject(project.Id)));

        await using var verify = fixture.CreateContext();
        var line = Assert.Single((await new MaterialCostService(verify).GetEstimatedMaterialCostAsync(project.Id))!.Lines);
        Assert.Equal(480m, line.UnitPrice);
        Assert.False(line.QuotationRequested);
    }

    [Fact]
    public async Task RequestQuotations_MaterialsAddedLater_CanBeSentToo()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, first) = await SeedAsync(db, "gal");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, first.Id, admin.Id, 1, estimatedPurchaseQuantity: 10, estimatedPurchaseUnit: "gal");
        await RequestAs(db, admin, project.Id, new RecordingNotifications());
        var inquiry = await db.MaterialRequests.SingleAsync(r => r.ProjectId == project.Id);
        await ControllerAs(db, admin, new RecordingNotifications())
            .SaveQuotes(project.Id, Save(inquiry.Id, new MaterialRequestQuoteDto { Slot = 1, SupplierName = "Laguna", UnitPrice = 480 }));

        var added = await TestDataBuilder.CreateMaterialAsync(db, unit: "bag");
        added.UnitCost = 0;
        await db.SaveChangesAsync();
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, added.Id, admin.Id, 1, estimatedPurchaseQuantity: 4, estimatedPurchaseUnit: "bag");

        var again = Assert.IsType<PriceInquiryResultDto>(Assert.IsType<OkObjectResult>(await RequestAs(db, admin, project.Id, new RecordingNotifications())).Value);

        Assert.Equal(1, again.Requested);
        Assert.Equal(0, again.AlreadyRequested);
        Assert.True(await db.MaterialRequests.AnyAsync(r => r.ProjectId == project.Id && r.MaterialId == added.Id && r.IsPriceInquiry));
    }

    [Fact]
    public async Task RequestQuotations_IncludesOrderedLinesWithNoPrice()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "pcs");
        // Bought without a price, and not in the Material Plan.
        await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id, material.Id, 8, unit: "pcs");

        var result = Assert.IsType<PriceInquiryResultDto>(Assert.IsType<OkObjectResult>(await RequestAs(db, admin, project.Id, new RecordingNotifications())).Value);

        Assert.Equal(1, result.Requested);
        var inquiry = await db.MaterialRequests.SingleAsync(r => r.ProjectId == project.Id);
        Assert.Equal(material.Id, inquiry.MaterialId);
        Assert.Equal(8m, inquiry.Quantity);
    }

    [Fact]
    public async Task RowWithNoForecast_IsSentPerItsCatalogUnit_AndThePriceShowsButStaysOutOfTheTotal()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "bag");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 120, estimatedPurchaseQuantity: null, estimatedPurchaseUnit: null);

        var before = await new MaterialCostService(db).GetEstimatedMaterialCostAsync(project.Id);
        Assert.Equal(1, before!.NoForecastItems);
        Assert.Equal(1, before.UnpricedItems);
        var line = Assert.Single(before.Lines);
        Assert.True(line.NoForecast);
        Assert.True(line.NeedsPrice);
        Assert.Equal("bag", line.Unit);

        var result = Assert.IsType<PriceInquiryResultDto>(Assert.IsType<OkObjectResult>(await RequestAs(db, admin, project.Id, new RecordingNotifications())).Value);
        Assert.Equal(1, result.Requested);
        var inquiry = await db.MaterialRequests.SingleAsync(r => r.ProjectId == project.Id);
        Assert.Equal("bag", inquiry.Unit);
        Assert.Equal(1m, inquiry.Quantity);
        Assert.NotNull(inquiry.Remarks);

        await ControllerAs(db, admin, new RecordingNotifications())
            .SaveQuotes(project.Id, Save(inquiry.Id, new MaterialRequestQuoteDto { Slot = 1, SupplierName = "Laguna", UnitPrice = 300 }));

        await using var verify = fixture.CreateContext();
        var after = await new MaterialCostService(verify).GetEstimatedMaterialCostAsync(project.Id);
        var priced = Assert.Single(after!.Lines);
        Assert.Equal(300m, priced.UnitPrice);
        Assert.False(priced.NeedsPrice);
        Assert.Equal(0m, after.TotalEstimatedCost);
        Assert.Equal(0, after.UnpricedItems);
        Assert.Equal(1, after.NoForecastItems);
    }

    [Fact]
    public async Task QuotePerBag_PricesAForecastTypedAsBags()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, material) = await SeedAsync(db, "bag");
        await TestDataBuilder.CreateBoqItemAsync(db, project.Id, material.Id, admin.Id, 1, estimatedPurchaseQuantity: 20, estimatedPurchaseUnit: "Bags");
        await RequestAs(db, admin, project.Id, new RecordingNotifications());
        var inquiry = await db.MaterialRequests.SingleAsync(r => r.ProjectId == project.Id);
        await ControllerAs(db, admin, new RecordingNotifications())
            .SaveQuotes(project.Id, Save(inquiry.Id, new MaterialRequestQuoteDto { Slot = 1, SupplierName = "Laguna", UnitPrice = 300 }));

        await using var verify = fixture.CreateContext();
        var cost = await new MaterialCostService(verify).GetEstimatedMaterialCostAsync(project.Id);

        Assert.Equal(6000m, cost!.TotalEstimatedCost);
        Assert.Equal(0, cost.UnpricedItems);
    }

    [Fact]
    public async Task RequestQuotations_ProjectManagerOnlyForTheirOwnProject()
    {
        await using var db = fixture.CreateContext();
        var owner = await TestDataBuilder.CreateUserAsync(db, UserRole.ProjectManager);
        var otherManager = await TestDataBuilder.CreateUserAsync(db, UserRole.ProjectManager);
        var project = await TestDataBuilder.CreateProjectAsync(db, owner.Id);

        Assert.IsType<OkObjectResult>(await RequestAs(db, owner, project.Id, new RecordingNotifications()));
        Assert.IsType<ForbidResult>(await RequestAs(db, otherManager, project.Id, new RecordingNotifications()));
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static async Task<(User, Project, Material)> SeedAsync(AppDbContext db, string unit)
    {
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: unit);
        material.UnitCost = 0; // no catalog price
        await db.SaveChangesAsync();
        return (admin, project, material);
    }

    private static async Task<MaterialRequest> AddRequestAsync(AppDbContext db, int projectId, int materialId, int userId, string unit,
        params (string Supplier, decimal Price, bool Selected, bool FromHistory)[] quotes)
    {
        var request = new MaterialRequest
        {
            ProjectId = projectId, MaterialId = materialId, Quantity = 10, Unit = unit, RequestedByUserId = userId,
            Quotes = quotes.Select((q, i) => new MaterialRequestQuote
            {
                Slot = i + 1, SupplierName = q.Supplier, UnitPrice = q.Price, IsSelected = q.Selected, PriceFromHistory = q.FromHistory,
            }).ToList(),
        };
        db.MaterialRequests.Add(request);
        await db.SaveChangesAsync();
        return request;
    }

    private static SaveRequestQuotesDto Save(int requestId, params MaterialRequestQuoteDto[] quotes) => new()
    {
        Requests = [new RequestQuotesDto { RequestId = requestId, Quotes = [.. quotes] }],
    };

    private static IEnumerable<MaterialRequestDto> Requests(IActionResult result) =>
        Assert.IsAssignableFrom<IEnumerable<MaterialRequestDto>>(Assert.IsType<OkObjectResult>(result).Value);

    private static Task<IActionResult> RequestAs(AppDbContext db, User user, int projectId, INotificationService notifications) =>
        ControllerAs(db, user, notifications).RequestQuotations(projectId, new MaterialCostService(db), new ProjectAccessService(db));

    private static MaterialRequestsController ControllerAs(AppDbContext db, User user, INotificationService notifications) =>
        new(db, notifications)
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
