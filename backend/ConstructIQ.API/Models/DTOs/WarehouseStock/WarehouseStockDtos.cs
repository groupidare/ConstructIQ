namespace ConstructIQ.API.Models.DTOs.WarehouseStock;

public class WarehouseStockItemDto
{
    public int     Id           { get; set; }
    public string  MaterialName { get; set; } = string.Empty;
    public string  Unit         { get; set; } = string.Empty;
    public decimal Balance      { get; set; }
    public DateTime SyncedAt    { get; set; }
}

public class WarehouseStockSyncResultDto
{
    public int      ItemCount { get; set; }
    public DateTime SyncedAt  { get; set; }
    public List<WarehouseStockItemDto> Items { get; set; } = [];
}

// ── Google Sheets API v4 response shape (only what we read) ───────────────────
// Cells come back as a mix of JSON strings and numbers (UNFORMATTED_VALUE
// still types them per-cell) — JsonElement handles either without throwing,
// unlike deserializing straight into List<List<string>>.

public class GoogleSheetsValueRangeResponse
{
    public List<List<System.Text.Json.JsonElement>>? Values { get; set; }
}
