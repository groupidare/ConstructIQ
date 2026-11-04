using System.Net;
using System.Text;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ConstructIQ.Tests;

[Collection("Database")]
public class WarehouseStockCurrentTests(DatabaseFixture fixture)
{
    private sealed class SheetHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, false) { BaseAddress = new Uri("https://sheets.test/") };
    }

    private static WarehouseStockService Service(AppDbContext db, HttpMessageHandler handler) => new(
        db, new Factory(handler),
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GOOGLE_SHEETS_API_KEY"] = "test", ["GOOGLE_SHEET_ID"] = "test",
        }).Build(),
        NullLogger<WarehouseStockService>.Instance);

    private static async Task SnapshotAsync(AppDbContext db, decimal balance, TimeSpan age)
    {
        db.WarehouseStockItems.RemoveRange(db.WarehouseStockItems);
        db.WarehouseStockItems.Add(new WarehouseStockItem { MaterialName = "Cement", Unit = "bag", Balance = balance, SyncedAt = DateTime.UtcNow - age });
        await db.SaveChangesAsync();
    }

    private const string SheetBody = """{"values":[["Cement","bag",50]]}""";

    [Fact] // A stale 0 must not read as "No stock" when the sheet has some.
    public async Task StaleSnapshot_IsRefreshedFromTheSheet()
    {
        await using var db = fixture.CreateContext();
        await SnapshotAsync(db, 0, TimeSpan.FromHours(1));
        var handler = new SheetHandler(HttpStatusCode.OK, SheetBody);

        var items = (await Service(db, handler).GetCurrentAsync()).ToList();

        Assert.Equal(1, handler.Calls);
        Assert.Equal(50, Assert.Single(items).Balance);
    }

    [Fact]
    public async Task RecentSnapshot_DoesNotCallTheSheet()
    {
        await using var db = fixture.CreateContext();
        await SnapshotAsync(db, 7, TimeSpan.FromMinutes(1));
        var handler = new SheetHandler(HttpStatusCode.OK, SheetBody);

        var items = (await Service(db, handler).GetCurrentAsync()).ToList();

        Assert.Equal(0, handler.Calls);
        Assert.Equal(7, Assert.Single(items).Balance);
    }

    [Fact]
    public async Task SheetOutage_FallsBackToTheSnapshot()
    {
        await using var db = fixture.CreateContext();
        await SnapshotAsync(db, 7, TimeSpan.FromHours(1));
        var handler = new SheetHandler(HttpStatusCode.ServiceUnavailable, "{}");

        var items = (await Service(db, handler).GetCurrentAsync()).ToList();

        Assert.Equal(1, handler.Calls);
        Assert.Equal(7, Assert.Single(items).Balance);
    }
}
