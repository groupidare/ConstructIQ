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
        // Units written into names ("Topcoat Paint, 1 gallon") aren't the product.
        "gallon", "gal", "liter", "litre", "ltr", "kilo", "meter", "metre", "pail", "can", "bottle",
        "tube", "bundle", "dozen", "pair", "lot", "point", "sack", "cubic", "material", "item",
    ];

    private static readonly HashSet<string> MeasureUnits =
        ["mm", "cm", "m", "inch", "in", "ft", "feet", "w", "watt", "v", "volt", "kg", "lb", "amp", "a", "hp", "mpa", "psi", "mm2"];

    private static readonly Regex NonAlnum = new("[^a-z0-9]+", RegexOptions.Compiled);

    // A name's words and sizes, worked out once when one name is compared
    // with many.
    public sealed record NameKey(HashSet<string> Words, HashSet<string> Sizes, string? Head);

    public static NameKey Prepare(string? name)
    {
        var (words, sizes) = Tokens(name);
        return new NameKey(words, sizes, Head(name));
    }

    // Looser than IsSimilar, for a second look by keyword: the same main noun
    // ("… Fan") plus at least one more shared word, and sizes that don't
    // conflict — an 8-inch exhaust fan matches another 8-inch one, never a
    // 10-inch one.
    // Loosest look: one name's main product word appears in the other
    // ("Wall Paint Finish … + primer" and "Topcoat Paint"), sizes not
    // conflicting. Used last, and only within the same unit.
    public static bool IsProductMatch(NameKey a, NameKey b)
    {
        var shared = (a.Head != null && b.Words.Contains(a.Head)) || (b.Head != null && a.Words.Contains(b.Head));
        return shared && (a.Sizes.Count == 0 || b.Sizes.Count == 0 || a.Sizes.Overlaps(b.Sizes));
    }

    // Two names that share words but name different products ("Stainless
    // Steel Kitchen Sink" vs "Stainless Steel Tile Termination Trim") — a
    // sign a row was linked to the wrong catalog material. Names sharing no
    // words at all (an abbreviation, "CHB" for "Concrete Hollow Block") are
    // not flagged: there's no evidence either way.
    public static bool IsDifferentProduct(string? a, string? b)
    {
        var ka = Prepare(a);
        var kb = Prepare(b);
        if (ka.Head is null || kb.Head is null || !ka.Words.Overlaps(kb.Words)) return false;
        return !IsSameKind(a, b);
    }

    public static bool IsKeywordMatch(NameKey a, NameKey b)
    {
        if (a.Head is null || a.Head != b.Head) return false;
        if (a.Words.Intersect(b.Words).Count() < 2) return false;
        return a.Sizes.Count == 0 || b.Sizes.Count == 0 || a.Sizes.Overlaps(b.Sizes);
    }

    public static bool IsSimilar(string? a, string? b) => IsSimilar(Prepare(a), Prepare(b));

    public static bool IsSimilar(NameKey a, NameKey b)
    {
        var (wordsA, sizesA) = (a.Words, a.Sizes);
        var (wordsB, sizesB) = (b.Words, b.Sizes);
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
        var all = Words(name).ToList();
        for (var i = 0; i < all.Count; i++)
        {
            var w = all[i];
            if (w.All(char.IsDigit))
            {
                // A bare number is a size only with a measuring unit after it
                // ("8 inch" → 8inch); otherwise it's a count ("2 coats", "1 gallon").
                if (i + 1 < all.Count && MeasureUnits.Contains(all[i + 1])) sizes.Add(w + all[i + 1]);
            }
            else if (w.Any(char.IsDigit)) sizes.Add(w);
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

    // A trailing single letter ("CircuitPro Electrical Trading B") is a branch
    // or entry marker, not a different supplier, so it's dropped too.
    public static string SupplierKey(string? name)
    {
        var words = NonAlnum.Split((name ?? "").ToLowerInvariant().Replace("&", " and "))
            .Where(w => w.Length > 0 && !CompanySuffixes.Contains(w))
            .ToList();
        while (words.Count > 1 && words[^1].Length == 1 && char.IsLetter(words[^1][0])) words.RemoveAt(words.Count - 1);
        return string.Join(' ', words);
    }
}
