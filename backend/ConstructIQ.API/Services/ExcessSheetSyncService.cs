using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Google.Apis.Auth.OAuth2;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Writes every logged Excess entry into the warehouse Google Sheet's STOCK IN
// columns (GOOGLE_SHEET_STOCK_IN_RANGE, default 'SBMI 2026'!F7:J), so the
// sheet's BAL formula counts it as stock back in, and every approved
// redistribution or warehouse release into STOCK OUT (GOOGLE_SHEET_STOCK_OUT_RANGE,
// default 'SBMI 2026'!L7:P), so it comes back out. The read-only API key the
// Inventory sync uses can't write, so this signs in as a Google service
// account (GOOGLE_SERVICE_ACCOUNT_KEY_FILE) the sheet is shared with as an
// Editor. Off — and entries are never marked pending — until that's set.
//
// One background worker does every write, so two entries saved at the same
// moment can never pick the same "next empty row". It runs shortly after each
// save (Trigger) and every 15 minutes, which retries anything that failed —
// the entry itself is already saved in the app either way.
public sealed class ExcessSheetSyncService(
    IServiceScopeFactory scopeFactory,
    IHttpClientFactory httpFactory,
    IConfiguration config,
    ILogger<ExcessSheetSyncService> logger) : BackgroundService, IExcessSheetSync
{
    private static readonly TimeSpan RetryInterval = TimeSpan.FromMinutes(15);
    // The Record Material Excess modal saves its rows as separate requests at
    // once — waiting a moment lets one pass write them all together.
    private static readonly TimeSpan BatchDelay = TimeSpan.FromSeconds(3);
    private const string SheetsScope = "https://www.googleapis.com/auth/spreadsheets";

    private readonly Channel<bool> _signal = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });
    private GoogleCredential? _credential;

    private string? KeyFile => config["GOOGLE_SERVICE_ACCOUNT_KEY_FILE"];
    private string? SheetId => config["GOOGLE_SHEET_ID"];
    private string StockRange => config["GOOGLE_SHEET_STOCK_RANGE"] ?? "'SBMI 2026'!B6:D1000";
    private string StockInRange => config["GOOGLE_SHEET_STOCK_IN_RANGE"] ?? "'SBMI 2026'!F7:J";
    private string StockOutRange => config["GOOGLE_SHEET_STOCK_OUT_RANGE"] ?? "'SBMI 2026'!L7:P";

    public bool Enabled => !string.IsNullOrWhiteSpace(KeyFile) && !string.IsNullOrWhiteSpace(SheetId);

    public void Trigger() => _signal.Writer.TryWrite(true);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled)
        {
            logger.LogInformation("Excess → Google Sheet sync is off (GOOGLE_SERVICE_ACCOUNT_KEY_FILE / GOOGLE_SHEET_ID not set).");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SyncPendingAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Excess → Google Sheet sync failed; will retry.");
            }

            using var wait = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            wait.CancelAfter(RetryInterval);
            try
            {
                await _signal.Reader.ReadAsync(wait.Token);
                await Task.Delay(BatchDelay, stoppingToken);
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
            {
                // Retry interval elapsed with no new entry — loop and retry.
            }
        }
    }

    private async Task SyncPendingAsync(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var pending = await db.ExcessWasteRecords
            .Include(e => e.Material).Include(e => e.Project)
            .Include(e => e.BOQItem).ThenInclude(b => b!.HistoricalSupplies)
            .Where(e => e.SheetSyncPending)
            .OrderBy(e => e.Id)
            .ToListAsync(ct);
        var pendingOut = await db.RedistributionRequests
            .Include(r => r.Material).Include(r => r.SourceProject).Include(r => r.TargetProject)
            .Include(r => r.SourceExcessWasteRecord).ThenInclude(e => e!.BOQItem).ThenInclude(b => b!.HistoricalSupplies)
            .Where(r => r.SheetSyncPending)
            .OrderBy(r => r.Id)
            .ToListAsync(ct);
        var pendingReleases = await db.WarehouseRequests
            .Include(w => w.Material).Include(w => w.Project).Include(w => w.BOQItem)
            .Include(w => w.ReleaseSources).ThenInclude(s => s.ExcessWasteRecord).ThenInclude(e => e.Project)
            .Where(w => w.SheetSyncPending)
            .OrderBy(w => w.Id)
            .ToListAsync(ct);
        if (pending.Count == 0 && pendingOut.Count == 0 && pendingReleases.Count == 0) return;

        var client = httpFactory.CreateClient("GoogleSheets");
        string? failure = null;
        try
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await GetAccessTokenAsync(ct));

            var sheetMaterials = (await GetValuesAsync(client, StockRange, ct))
                .Where(r => r.Count > 0)
                .Select(r => new StockInSheetRows.SheetMaterial(Cell(r, 0), Cell(r, 1)))
                .ToList();

            var (rows, skipped) = StockInSheetRows.Build(
                pending.Select(e => new StockInSheetRows.ExcessEntry(
                    e.Id, e.RecordedAt, e.Material.Name,
                    ExcessWasteService.PreferredUnit(e.BOQItem, e.Material.Unit),
                    e.Quantity, e.Project.Name,
                    e.BOQItem?.HistoricalSupplies.Select(h => new StockInSheetRows.SheetMaterial(h.MaterialName, h.Unit)).ToList())),
                sheetMaterials);

            var byId = pending.ToDictionary(e => e.Id);
            foreach (var s in skipped)
            {
                var record = byId[s.RecordId];
                record.SheetSyncPending = false;
                record.SheetSyncError = Truncate(s.Reason);
            }

            if (rows.Count > 0)
            {
                await AppendRowsAsync(client, StockInRange, rows.Select(r => r.Values).ToList(), ct);
                foreach (var row in rows)
                {
                    var record = byId[row.RecordId];
                    record.SheetSyncPending = false;
                    record.SheetSyncedAt = DateTime.UtcNow;
                    record.SheetSyncError = Truncate(row.Note);
                }
                logger.LogInformation("Wrote {Count} excess entr(ies) to the Google Sheet's STOCK IN.", rows.Count);
            }

            // After STOCK IN, so a transfer can find the row of an Excess entry
            // written in this same pass.
            if (pendingOut.Count > 0)
                await WriteStockOutAsync(client, pendingOut, sheetMaterials, ct);
            if (pendingReleases.Count > 0)
                await WriteReleasesAsync(client, db, pendingReleases, sheetMaterials, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Couldn't write excess entries to the Google Sheet.");
            failure = Truncate($"Couldn't write to the Google Sheet (will retry): {ex.Message}");
        }

        if (failure is not null)
        {
            foreach (var record in pending.Where(e => e.SheetSyncPending))
                record.SheetSyncError = failure;
            foreach (var request in pendingOut.Where(r => r.SheetSyncPending))
                request.SheetSyncError = failure;
            foreach (var release in pendingReleases.Where(w => w.SheetSyncPending))
                release.SheetSyncError = failure;
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task<List<StockOutSheetRows.StockInRow>> ReadStockInAsync(HttpClient client, CancellationToken ct) =>
        (await GetValuesAsync(client, StockInRange, ct))
            .Select(r => new StockOutSheetRows.StockInRow(Cell(r, 1), Cell(r, 2), Cell(r, 3),
                decimal.TryParse(Cell(r, 4), NumberStyles.Number, CultureInfo.InvariantCulture, out var qty) ? qty : 0))
            .ToList();

    // The warehouse's own name for it when the BOQ wording is linked to one, and
    // the Excess entry it used first when there is one, so it hits the same balance.
    public static StockOutSheetRows.Entry ReleaseEntry(WarehouseRequest release, IReadOnlyDictionary<string, string> links)
    {
        var linked = links.GetValueOrDefault(StockInSheetRows.NameKey(release.BOQItem?.Specification ?? string.Empty));
        var source = release.ReleaseSources.OrderBy(s => s.Id).FirstOrDefault()?.ExcessWasteRecord;
        return new StockOutSheetRows.Entry(
            release.Id, linked ?? release.Material.Name,
            string.IsNullOrWhiteSpace(release.Unit) ? release.Material.Unit : release.Unit,
            release.ApprovedQuantity ?? 0, release.Project.Name,
            source?.Project?.Name, source?.LoggedQuantity);
    }

    private async Task WriteReleasesAsync(
        HttpClient client, AppDbContext db, List<WarehouseRequest> releases, List<StockInSheetRows.SheetMaterial> sheetMaterials, CancellationToken ct)
    {
        var links = await db.WarehouseStockLinks
            .Where(l => l.WarehouseMaterialName != null)
            .ToDictionaryAsync(l => l.BoqNameKey, l => l.WarehouseMaterialName!, ct);
        var (rows, skipped) = StockOutSheetRows.Build(
            releases.Select(w => ReleaseEntry(w, links)), sheetMaterials, await ReadStockInAsync(client, ct));

        var byId = releases.ToDictionary(w => w.Id);
        foreach (var s in skipped)
        {
            var release = byId[s.RecordId];
            release.SheetSyncPending = false;
            release.SheetSyncError = Truncate(s.Reason);
        }

        if (rows.Count == 0) return;
        await AppendRowsAsync(client, StockOutRange, rows.Select(r => r.Values).ToList(), ct);
        foreach (var row in rows)
        {
            var release = byId[row.RecordId];
            release.SheetSyncPending = false;
            release.SheetSyncedAt = DateTime.UtcNow;
            release.SheetSyncError = Truncate(row.Note);
        }
        logger.LogInformation("Wrote {Count} warehouse release(s) to the Google Sheet's STOCK OUT.", rows.Count);
    }

    private async Task WriteStockOutAsync(
        HttpClient client, List<RedistributionRequest> pendingOut, List<StockInSheetRows.SheetMaterial> sheetMaterials, CancellationToken ct)
    {
        var stockIn = await ReadStockInAsync(client, ct);

        var (rows, skipped) = StockOutSheetRows.Build(
            pendingOut.Select(r =>
            {
                var source = r.SourceExcessWasteRecord;
                var onSheet = source?.SheetSyncedAt is not null;
                return new StockOutSheetRows.Entry(
                    r.Id, r.Material.Name,
                    ExcessWasteService.PreferredUnit(source?.BOQItem, r.Material.Unit),
                    r.Quantity, r.TargetProject.Name,
                    onSheet ? r.SourceProject.Name : null,
                    onSheet ? source!.LoggedQuantity : null,
                    source?.BOQItem?.HistoricalSupplies.Select(h => new StockInSheetRows.SheetMaterial(h.MaterialName, h.Unit)).ToList());
            }),
            sheetMaterials, stockIn);

        var byId = pendingOut.ToDictionary(r => r.Id);
        foreach (var s in skipped)
        {
            var request = byId[s.RecordId];
            request.SheetSyncPending = false;
            request.SheetSyncError = Truncate(s.Reason);
        }

        if (rows.Count == 0) return;
        await AppendRowsAsync(client, StockOutRange, rows.Select(r => r.Values).ToList(), ct);
        foreach (var row in rows)
        {
            var request = byId[row.RecordId];
            request.SheetSyncPending = false;
            request.SheetSyncedAt = DateTime.UtcNow;
            request.SheetSyncError = Truncate(row.Note);
        }
        logger.LogInformation("Wrote {Count} redistribution(s) to the Google Sheet's STOCK OUT.", rows.Count);
    }

    // Writes below the last filled row of the range rather than via the Sheets
    // "append" call, whose table detection can land in a gap between rows.
    private async Task AppendRowsAsync(HttpClient client, string range, List<IReadOnlyList<object>> rows, CancellationToken ct)
    {
        var m = Regex.Match(range, @"^(?<sheet>.+)!(?<c1>[A-Za-z]+)(?<r1>\d+):(?<c2>[A-Za-z]+)\d*$");
        if (!m.Success)
            throw new InvalidOperationException($"Sheet range \"{range}\" must look like 'Sheet name'!F7:J.");
        string sheet = m.Groups["sheet"].Value, c1 = m.Groups["c1"].Value, c2 = m.Groups["c2"].Value;
        var firstRow = int.Parse(m.Groups["r1"].Value);

        // The API trims trailing empty rows but keeps blank rows in between,
        // so the count is exactly how far down the last filled row is.
        var existing = await GetValuesAsync(client, $"{sheet}!{c1}{firstRow}:{c2}", ct);
        var start = firstRow + existing.Count;
        var target = $"{sheet}!{c1}{start}:{c2}{start + rows.Count - 1}";

        var response = await client.PutAsJsonAsync(
            $"v4/spreadsheets/{SheetId}/values/{Uri.EscapeDataString(target)}?valueInputOption=USER_ENTERED",
            new { range = target, majorDimension = "ROWS", values = rows }, ct);
        await EnsureSuccessAsync(response, ct);
    }

    private async Task<List<List<JsonElement>>> GetValuesAsync(HttpClient client, string range, CancellationToken ct)
    {
        var response = await client.GetAsync(
            $"v4/spreadsheets/{SheetId}/values/{Uri.EscapeDataString(range)}?valueRenderOption=UNFORMATTED_VALUE", ct);
        await EnsureSuccessAsync(response, ct);
        var body = await response.Content.ReadFromJsonAsync<ValueRange>(cancellationToken: ct);
        return body?.Values ?? [];
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken ct)
    {
        _credential ??= CredentialFactory.FromFile<ServiceAccountCredential>(KeyFile!)
            .ToGoogleCredential()
            .CreateScoped(SheetsScope);
        return await _credential.UnderlyingCredential.GetAccessTokenForRequestAsync(cancellationToken: ct);
    }

    // Google's error body says what's wrong (e.g. the sheet isn't shared with
    // the service account) — far more useful in the log than a bare 403.
    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode) return;
        var body = await response.Content.ReadAsStringAsync(ct);
        throw new HttpRequestException($"Google Sheets returned {(int)response.StatusCode}: {body}");
    }

    private static string Cell(List<JsonElement> row, int index) =>
        index < row.Count ? row[index].ToString().Trim() : string.Empty;

    private static string? Truncate(string? text) =>
        text is null ? null : text.Length <= 300 ? text : text[..297] + "...";

    private sealed record ValueRange(List<List<JsonElement>>? Values);
}
