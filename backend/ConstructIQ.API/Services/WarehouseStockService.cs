using System.Net.Http.Json;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.WarehouseStock;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class WarehouseStockService(
    AppDbContext db,
    IHttpClientFactory httpFactory,
    IConfiguration config,
    ILogger<WarehouseStockService> logger) : IWarehouseStockService
{
    public async Task<IEnumerable<WarehouseStockItemDto>> GetAllAsync()
    {
        var items = await db.WarehouseStockItems.OrderBy(i => i.Id).ToListAsync();
        return items.Select(ToDto);
    }

    // The snapshot only changes on a manual sync, but the sheet's balances move
    // all the time — a stale 0 would send material to Procurement that the
    // warehouse actually has. The lock keeps two refreshes from both replacing
    // the snapshot. A sheet outage falls back to the snapshot rather than failing.
    private static readonly SemaphoreSlim RefreshLock = new(1, 1);
    private static readonly TimeSpan MaxSnapshotAge = TimeSpan.FromMinutes(5);

    public async Task<IEnumerable<WarehouseStockItemDto>> GetCurrentAsync()
    {
        await RefreshLock.WaitAsync();
        try
        {
            var syncedAt = await db.WarehouseStockItems.MaxAsync(i => (DateTime?)i.SyncedAt);
            if (syncedAt is null || DateTime.UtcNow - syncedAt > MaxSnapshotAge)
            {
                try
                {
                    await SyncFromGoogleSheetAsync();
                }
                catch (InvalidOperationException ex)
                {
                    logger.LogWarning(ex, "Couldn't refresh warehouse stock; using the snapshot from {SyncedAt}.", syncedAt);
                }
            }
        }
        finally
        {
            RefreshLock.Release();
        }
        return await GetAllAsync();
    }

    public async Task<WarehouseStockSyncResultDto> SyncFromGoogleSheetAsync()
    {
        var apiKey = config["GOOGLE_SHEETS_API_KEY"];
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("GOOGLE_SHEETS_API_KEY is not configured.");

        var sheetId = config["GOOGLE_SHEET_ID"]
            ?? throw new InvalidOperationException("GOOGLE_SHEET_ID is not configured.");

        var range = config["GOOGLE_SHEET_STOCK_RANGE"] ?? "'SBMI 2026'!B6:D1000";

        var client = httpFactory.CreateClient("GoogleSheets");
        var url = $"v4/spreadsheets/{sheetId}/values/{Uri.EscapeDataString(range)}" +
                  $"?key={apiKey}&valueRenderOption=UNFORMATTED_VALUE";

        GoogleSheetsValueRangeResponse? sheetResponse;
        try
        {
            var response = await client.GetAsync(url);
            response.EnsureSuccessStatusCode();
            sheetResponse = await response.Content.ReadFromJsonAsync<GoogleSheetsValueRangeResponse>();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to fetch warehouse stock balance from Google Sheets.");
            throw new InvalidOperationException("Couldn't reach the Google Sheet. Check the API key, sheet ID, and that the sheet is still shared as \"Anyone with the link can view\".");
        }

        var rows = sheetResponse?.Values ?? [];

        var parsed = new List<WarehouseStockItem>();
        foreach (var row in rows)
        {
            var materialName = row.Count > 0 ? row[0].ToString().Trim() : null;
            if (string.IsNullOrWhiteSpace(materialName)) continue; // blank template row

            var unit = row.Count > 1 ? row[1].ToString().Trim() : string.Empty;
            var balanceRaw = row.Count > 2 ? row[2].ToString() : null;
            decimal.TryParse(balanceRaw, out var balance);

            parsed.Add(new WarehouseStockItem
            {
                MaterialName = materialName,
                Unit         = unit,
                Balance      = balance,
                SyncedAt     = DateTime.UtcNow,
            });
        }

        // Full replace — the sheet has no per-row IDs or change timestamps to
        // diff against, so each sync is a fresh snapshot, not an upsert.
        db.WarehouseStockItems.RemoveRange(db.WarehouseStockItems);
        db.WarehouseStockItems.AddRange(parsed);
        await db.SaveChangesAsync();

        return new WarehouseStockSyncResultDto
        {
            ItemCount = parsed.Count,
            SyncedAt  = DateTime.UtcNow,
            Items     = parsed.Select(ToDto).ToList(),
        };
    }

    public async Task<IEnumerable<WarehouseStockLinkDto>> GetLinksAsync()
    {
        var links = await db.WarehouseStockLinks.AsNoTracking().ToListAsync();
        return links.Select(ToDto);
    }

    public async Task<WarehouseStockLinkDto> SaveLinkAsync(string boqName, string? warehouseMaterialName)
    {
        var key = StockInSheetRows.NameKey(boqName);
        if (key.Length == 0) throw new InvalidOperationException("This row has no material name to link.");

        string? itemName = null;
        if (warehouseMaterialName is not null)
        {
            // The sheet's own spelling, so the link keeps finding its balance.
            var itemKey = StockInSheetRows.NameKey(warehouseMaterialName);
            var names = await db.WarehouseStockItems.Select(i => i.MaterialName).ToListAsync();
            itemName = names.FirstOrDefault(n => StockInSheetRows.NameKey(n) == itemKey)
                ?? throw new InvalidOperationException($"\"{warehouseMaterialName.Trim()}\" is no longer on the warehouse list. Reopen the plan to refresh it.");
        }

        var link = await db.WarehouseStockLinks.FirstOrDefaultAsync(l => l.BoqNameKey == key);
        if (link is null)
        {
            link = new WarehouseStockLink { BoqNameKey = key };
            db.WarehouseStockLinks.Add(link);
        }
        link.BoqName = boqName.Trim();
        link.WarehouseMaterialName = itemName;
        link.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return ToDto(link);
    }

    public async Task RemoveLinkAsync(string boqName)
    {
        var key = StockInSheetRows.NameKey(boqName);
        var link = await db.WarehouseStockLinks.FirstOrDefaultAsync(l => l.BoqNameKey == key);
        if (link is null) return;
        db.WarehouseStockLinks.Remove(link);
        await db.SaveChangesAsync();
    }

    private static WarehouseStockLinkDto ToDto(WarehouseStockLink l) => new()
    {
        BoqName               = l.BoqName,
        WarehouseMaterialName = l.WarehouseMaterialName,
    };

    private static WarehouseStockItemDto ToDto(WarehouseStockItem i) => new()
    {
        Id           = i.Id,
        MaterialName = i.MaterialName,
        Unit         = i.Unit,
        Balance      = i.Balance,
        SyncedAt     = i.SyncedAt,
    };
}
