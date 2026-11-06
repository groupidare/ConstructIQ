using System.Text.RegularExpressions;

namespace ConstructIQ.API.Algorithms;

// A material's name in one comparable form, so the same product written two
// ways isn't two catalog materials: "Steel Sheet, 0.50mm thick" and "steel
// sheet, 0.5 mm  thick" are one. A price, stock or history is tied to the
// catalog material, so a near-duplicate starts with none of them.
public static partial class MaterialNames
{
    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    // A decimal with trailing zeros: 0.50, 1.0, 12.500 (never 100 or 0.05).
    [GeneratedRegex(@"\d+\.\d*0(?!\d)")]
    private static partial Regex TrailingZeros();

    // .5 → 0.5
    [GeneratedRegex(@"(?<![\d.])\.(\d)")]
    private static partial Regex BareDecimal();

    // "0.5 mm" → "0.5mm"
    [GeneratedRegex(@"(\d)\s+(mm|cm|m|kg|g|l|ml|in|ft|psi)\b")]
    private static partial Regex SpacedUnit();

    public static string Canonical(string? name)
    {
        var s = Spaces().Replace((name ?? string.Empty).Trim().ToLowerInvariant(), " ");
        s = BareDecimal().Replace(s, "0.$1");
        s = TrailingZeros().Replace(s, m => m.Value.TrimEnd('0').TrimEnd('.'));
        return SpacedUnit().Replace(s, "$1$2");
    }
}
