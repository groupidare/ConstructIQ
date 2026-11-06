using ConstructIQ.API.Data;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Algorithms;

// Whether two things in the app are the same item on the warehouse's sheet.
// Their catalog Material can't say on its own: saving can merge a row into a
// differently-named Material, so a person's stock link is what really says what
// a row's wording is in the warehouse. With no link either way, it's the same
// Material or the same name.
public static class WarehouseItemMatch
{
    public sealed record Item(int MaterialId, string? Wording, string MaterialName);

    public static async Task<Dictionary<string, string>> LoadLinksAsync(AppDbContext db) =>
        await db.WarehouseStockLinks
            .Where(l => l.WarehouseMaterialName != null)
            .ToDictionaryAsync(l => l.BoqNameKey, l => l.WarehouseMaterialName!);

    public static bool Same(Item a, Item b, IReadOnlyDictionary<string, string> links)
    {
        var linkedA = LinkedKey(a, links);
        var linkedB = LinkedKey(b, links);
        if (linkedA is not null && linkedB is not null) return linkedA == linkedB;
        if (linkedA is not null) return Names(b).Contains(linkedA);
        if (linkedB is not null) return Names(a).Contains(linkedB);
        return a.MaterialId == b.MaterialId || Names(a).Overlaps(Names(b));
    }

    private static HashSet<string> Names(Item item)
    {
        var names = new HashSet<string> { StockInSheetRows.NameKey(item.MaterialName) };
        if (!string.IsNullOrWhiteSpace(item.Wording)) names.Add(StockInSheetRows.NameKey(item.Wording));
        return names;
    }

    // The row's own wording decides; its catalog name only if it has none.
    private static string? LinkedKey(Item item, IReadOnlyDictionary<string, string> links)
    {
        var name = string.IsNullOrWhiteSpace(item.Wording) ? item.MaterialName : item.Wording;
        return links.TryGetValue(StockInSheetRows.NameKey(name), out var linked) ? StockInSheetRows.NameKey(linked) : null;
    }
}
