namespace ConstructIQ.API.Algorithms;

using SheetMaterial = StockInSheetRows.SheetMaterial;

// Pure rules for turning an approved redistribution into a row of the warehouse
// Google Sheet's STOCK OUT columns (DATE | MATERIALS | PROJECT | UNIT | OUT).
// DATE stays blank: the warehouse fills it in when the material actually leaves,
// which isn't when the transfer was approved.
//
// A redistribution moves out what its Excess entry brought in, so the OUT row
// must hit the same balance as that entry's STOCK IN row. People correct those
// rows on the sheet (picking the warehouse's name from the dropdown), so the
// sheet's row is the truth: its name and unit are copied as they stand now.
public static class StockOutSheetRows
{
    // SourceProjectName / LoggedExcessQuantity identify the Excess entry's
    // STOCK IN row; null when the transfer has no entry on the sheet.
    public sealed record Entry(int RequestId, string MaterialName, string Unit, decimal Quantity, string TargetProjectName,
        string? SourceProjectName = null, decimal? LoggedExcessQuantity = null, IReadOnlyList<SheetMaterial>? PurchasedAs = null);

    public sealed record StockInRow(string Material, string Supplier, string Unit, decimal Quantity);

    public static (List<StockInSheetRows.Row> Rows, List<StockInSheetRows.Skipped> Skipped) Build(
        IEnumerable<Entry> entries, IEnumerable<SheetMaterial> sheetMaterials, IEnumerable<StockInRow> stockIn)
    {
        var byName = StockInSheetRows.IndexByName(sheetMaterials);
        var stockInRows = stockIn.ToList();

        var rows = new List<StockInSheetRows.Row>();
        var skipped = new List<StockInSheetRows.Skipped>();
        foreach (var e in entries)
        {
            if (e.Quantity <= 0) { skipped.Add(new StockInSheetRows.Skipped(e.RequestId, "Nothing to subtract — the quantity is 0.")); continue; }

            string name, unit;
            string? note;
            if (FindStockInRow(e, stockInRows) is { } source)
            {
                (name, unit) = (source.Material.Trim(), source.Unit.Trim());
                note = byName.ContainsKey(StockInSheetRows.NameKey(name)) ? null : StockInSheetRows.NotOnSheetNote(name);
            }
            else
            {
                var (material, skipReason) = StockInSheetRows.ResolveMaterial(e.MaterialName, e.Unit, e.PurchasedAs, byName);
                if (material is null) { skipped.Add(new StockInSheetRows.Skipped(e.RequestId, skipReason!)); continue; }
                (name, unit, note) = (material.Name, material.Unit, material.Note);
            }

            rows.Add(new StockInSheetRows.Row(e.RequestId, ["", name, e.TargetProjectName.Trim(), unit, e.Quantity], note));
        }
        return (rows, skipped);
    }

    // Rows carry no id, so an entry's row is found by what was written: its
    // project, unit and logged quantity. If that points at two different
    // materials there's no telling which, so neither is trusted.
    private static StockInRow? FindStockInRow(Entry e, List<StockInRow> stockIn)
    {
        if (e.SourceProjectName is null || e.LoggedExcessQuantity is null) return null;

        var supplier = StockInSheetRows.SupplierFor(e.SourceProjectName);
        var unit = CompletedProjectDemandRules.NormalizeUnit(e.Unit);
        var candidates = stockIn
            .Where(r => string.Equals(r.Supplier.Trim(), supplier, StringComparison.OrdinalIgnoreCase)
                && r.Quantity == e.LoggedExcessQuantity
                && CompletedProjectDemandRules.NormalizeUnit(r.Unit) == unit
                && !string.IsNullOrWhiteSpace(r.Material))
            .ToList();
        return candidates.Select(r => StockInSheetRows.NameKey(r.Material)).Distinct().Count() == 1 ? candidates[^1] : null;
    }
}
