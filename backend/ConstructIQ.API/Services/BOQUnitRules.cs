using System.Text.RegularExpressions;

namespace ConstructIQ.API.Services;

// Single canonical place for the "is this unit an area unit" rule, so
// coverage-area derivation is consistent regardless of where a BOQ row
// originated (manual entry, scan review, etc.) — see BOQService.
public static class BOQUnitRules
{
    private static readonly Regex AreaUnitPattern = new(
        @"^(sq\.?\s*m\.?|sqm|m2|m²)$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool IsAreaUnit(string? unit)
    {
        if (string.IsNullOrWhiteSpace(unit)) return false;
        var normalized = unit.Trim();
        return AreaUnitPattern.IsMatch(normalized);
    }
}
