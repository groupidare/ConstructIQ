namespace ConstructIQ.API.Algorithms;

// Pure, DB- and network-free rules for turning logged Excess into rows of the
// warehouse Google Sheet's STOCK IN columns (DATE | MATERIALS | SUPPLIER |
// UNIT | IN) — kept out of ExcessSheetSyncService so they can be unit-tested.
//
// The sheet's BAL column is SUMIF(STOCK IN materials = the STOCK BALANCE
// name) − SUMIF(STOCK OUT …), matched on the exact material name. So a row
// only moves a balance when its MATERIALS cell is spelled exactly like the
// sheet's own STOCK BALANCE entry: the material is looked up there first
// (ignoring case and spacing) and written with the sheet's spelling and unit.
public static class StockInSheetRows
{
    // PurchasedAs: what was actually bought for the entry's BOQ row (its PO
    // lines). A BOQ row is often a work item ("CHB (150mm) + Plaster + Paint")
    // the sheet doesn't list, while its PO line ("Concrete Hollow Block,
    // 150mm, Class A") is exactly what the warehouse counts.
    public sealed record ExcessEntry(int RecordId, DateTime RecordedAtUtc, string MaterialName, string Unit, decimal Quantity, string ProjectName,
        IReadOnlyList<SheetMaterial>? PurchasedAs = null);
    public sealed record SheetMaterial(string Name, string Unit);

    // Values for one STOCK IN row: DATE (yyyy-MM-dd, entered so the sheet
    // reads it as a date), MATERIALS, SUPPLIER, UNIT, IN.
    public sealed record Row(int RecordId, IReadOnlyList<object> Values, string? Note);
    public sealed record Skipped(int RecordId, string Reason);
    public sealed record ResolvedMaterial(string Name, string Unit, string? Note);

    // The warehouse works in Philippine time; a 7 a.m. entry must not land on
    // the previous day's date. The Philippines has no daylight saving.
    private static readonly TimeSpan ManilaOffset = TimeSpan.FromHours(8);

    public static string SupplierFor(string projectName) => $"Excess from {projectName.Trim()}";

    public static (List<Row> Rows, List<Skipped> Skipped) Build(IEnumerable<ExcessEntry> entries, IEnumerable<SheetMaterial> sheetMaterials)
    {
        var byName = IndexByName(sheetMaterials);

        var rows = new List<Row>();
        var skipped = new List<Skipped>();
        foreach (var e in entries)
        {
            if (e.Quantity <= 0) { skipped.Add(new Skipped(e.RecordId, "Nothing to add — the quantity is 0.")); continue; }

            var (material, skipReason) = ResolveMaterial(e.MaterialName, e.Unit, e.PurchasedAs, byName);
            if (material is null) { skipped.Add(new Skipped(e.RecordId, skipReason!)); continue; }

            var date = DateOnly.FromDateTime(e.RecordedAtUtc.Add(ManilaOffset));
            rows.Add(new Row(e.RecordId,
                [date.ToString("yyyy-MM-dd"), material.Name, SupplierFor(e.ProjectName), material.Unit, e.Quantity],
                material.Note));
        }
        return (rows, skipped);
    }

    internal static Dictionary<string, SheetMaterial> IndexByName(IEnumerable<SheetMaterial> sheetMaterials) =>
        sheetMaterials
            .Where(m => !string.IsNullOrWhiteSpace(m.Name))
            .GroupBy(m => NameKey(m.Name))
            .ToDictionary(g => g.Key, g => g.First());

    // What to write in the MATERIALS and UNIT cells, or why nothing should be.
    internal static (ResolvedMaterial? Material, string? SkipReason) ResolveMaterial(
        string materialName, string entryUnit, IReadOnlyList<SheetMaterial>? purchasedAs, Dictionary<string, SheetMaterial> byName)
    {
        string name = materialName.Trim(), unit = entryUnit.Trim();
        if (byName.TryGetValue(NameKey(materialName), out var match)
            || (match = PurchasedMatch(unit, purchasedAs, byName)) is not null)
        {
            // Same material but counted in another unit (e.g. the sheet in
            // boxes, the excess in sq.m): writing it would put sq.m into a box
            // balance. Left for someone to convert and enter by hand.
            if (!string.IsNullOrWhiteSpace(match.Unit) && !string.IsNullOrWhiteSpace(unit)
                && CompletedProjectDemandRules.NormalizeUnit(match.Unit) != CompletedProjectDemandRules.NormalizeUnit(unit))
                return (null, $"Not written: the sheet counts \"{match.Name}\" in {match.Unit.Trim()}, but this entry is in {unit} — convert it and enter it on the sheet by hand.");

            return (new ResolvedMaterial(match.Name.Trim(), string.IsNullOrWhiteSpace(match.Unit) ? unit : match.Unit.Trim(), null), null);
        }

        // Not on the sheet either way — still write what was bought
        // ("CHB, 100mm thick, Class A") rather than the work item.
        var bought = (purchasedAs ?? [])
            .Where(p => CompletedProjectDemandRules.NormalizeUnit(p.Unit) == CompletedProjectDemandRules.NormalizeUnit(unit))
            .Select(p => p.Name.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (bought.Count == 1) name = bought[0];
        return (new ResolvedMaterial(name, unit, NotOnSheetNote(name)), null);
    }

    internal static string NotOnSheetNote(string name) =>
        $"Written, but \"{name}\" isn't on the sheet's STOCK BALANCE list, so no balance changed — add it there (same spelling) to count it.";

    // The one purchased material for this row that's on the sheet in the
    // excess's unit (100 pc of excess on a CHB + plaster + paint row is the
    // CHB). None, or more than one, and it's left to the logged name.
    private static SheetMaterial? PurchasedMatch(string entryUnit, IReadOnlyList<SheetMaterial>? purchasedAs, Dictionary<string, SheetMaterial> byName)
    {
        var unit = CompletedProjectDemandRules.NormalizeUnit(entryUnit);
        var found = (purchasedAs ?? [])
            .Where(p => CompletedProjectDemandRules.NormalizeUnit(p.Unit) == unit)
            .Select(p => byName.GetValueOrDefault(NameKey(p.Name)))
            .Where(m => m is not null && (string.IsNullOrWhiteSpace(m.Unit) || CompletedProjectDemandRules.NormalizeUnit(m.Unit) == unit))
            .Distinct()
            .ToList();
        return found.Count == 1 ? found[0] : null;
    }

    internal static string NameKey(string name) =>
        string.Join(' ', name.Trim().ToLowerInvariant().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
