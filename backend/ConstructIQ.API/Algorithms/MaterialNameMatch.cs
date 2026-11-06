using System.Text.RegularExpressions;

namespace ConstructIQ.API.Algorithms;

// Name matching for the Material Request Form's supplier auto-fill, used when
// a material has too little order history of its own.
//  - Similar: very likely the same product written differently, e.g. "300mm
//    x 300mm Ceramic Floor Tiles (FF-2)" and "Non-slip Ceramic Floor Tile,
//    300mm x 300mm". Its PO prices are offered, marked as from a similar
//    material. Sizes must agree, so a 600×600 tile never prices a 300×300.
//  - Same kind: the same kind of product (the main noun matches), e.g. tile
//    grout and floor tiles. Only its suppliers are offered, never a price.
public static class MaterialNameMatch
{
    // Words that describe packaging or grade rather than what the product is.
    private static readonly HashSet<string> Generic =
    [
        "with", "and", "for", "the", "per", "pack", "bag", "box", "pcs", "piece", "pieces", "roll",
        "sheet", "thick", "class", "type", "grade", "size", "unit", "set", "each", "length", "gauge",
    ];

    private static readonly Regex NonAlnum = new("[^a-z0-9]+", RegexOptions.Compiled);

    public static bool IsSimilar(string? a, string? b)
    {
        var (wordsA, sizesA) = Tokens(a);
        var (wordsB, sizesB) = Tokens(b);
        if (wordsA.Count == 0 || wordsB.Count == 0) return false;
        var shared = wordsA.Intersect(wordsB).Count();
        if (shared < 2 || shared < 0.5 * Math.Min(wordsA.Count, wordsB.Count)) return false;
        // Both give sizes → they have to share one.
        return sizesA.Count == 0 || sizesB.Count == 0 || sizesA.Overlaps(sizesB);
    }

    public static bool IsSameKind(string? a, string? b)
    {
        var (wordsA, _) = Tokens(a);
        var (wordsB, _) = Tokens(b);
        var headA = Head(a);
        var headB = Head(b);
        return (headA != null && wordsB.Contains(headA)) || (headB != null && wordsA.Contains(headB));
    }

    // The product's main noun: its last descriptive word ("Tile Grout" → grout).
    private static string? Head(string? name) =>
        Words(name).LastOrDefault(w => w.Length >= 3 && !w.Any(char.IsDigit) && !Generic.Contains(w));

    private static (HashSet<string> Words, HashSet<string> Sizes) Tokens(string? name)
    {
        var words = new HashSet<string>();
        var sizes = new HashSet<string>();
        foreach (var w in Words(name))
        {
            if (w.Any(char.IsDigit)) sizes.Add(w);
            else if (w.Length >= 3 && !Generic.Contains(w)) words.Add(w);
        }
        return (words, sizes);
    }

    private static IEnumerable<string> Words(string? name) =>
        NonAlnum.Split((name ?? "").ToLowerInvariant())
            .Where(w => w.Length > 0)
            .Select(Singular);

    private static string Singular(string w) =>
        w.Length > 3 && w.EndsWith('s') && !w.EndsWith("ss") && !w.Any(char.IsDigit) ? w[..^1] : w;

    // One supplier written two ways ("CircuitPro Electrical Trading" and
    // "CircuitPro Electrical Trading Corp.") is one supplier.
    private static readonly HashSet<string> CompanySuffixes =
        ["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc", "opc", "phil", "phils", "philippines"];

    public static string SupplierKey(string? name) =>
        string.Join(' ', NonAlnum.Split((name ?? "").ToLowerInvariant().Replace("&", " and "))
            .Where(w => w.Length > 0 && !CompanySuffixes.Contains(w)));
}
