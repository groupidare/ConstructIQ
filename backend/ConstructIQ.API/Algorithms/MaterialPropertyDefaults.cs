using System.Text.RegularExpressions;
using ConstructIQ.API.Models.Entities;

namespace ConstructIQ.API.Algorithms;

// Typical physical properties for common Philippine construction materials,
// matched by name + catalog unit. Only ever fills a material that has NO
// properties yet (an Admin's own values are never overwritten), and every
// filled row is marked as a default to verify against the supplier's TDS.
// Assembly rows ("CHB + Plaster + Paint Finish", per sq.m) are left alone:
// their catalog unit is the work unit, with nothing to convert.
public static class MaterialPropertyDefaults
{
    public const string Source = "ConstructIQ typical default — verify against supplier TDS";

    private static readonly HashSet<string> Pieces = ["pc", "pcs", "piece", "pieces"];
    private static readonly HashSet<string> CubicMeters = ["cu.m", "cum", "m3", "cbm"];
    private static readonly HashSet<string> SquareMeters = ["sq.m", "sqm", "m2"];
    private static readonly HashSet<string> Gallons = ["gal", "gallon", "can"];
    private static readonly HashSet<string> Sheets = ["sht", "sheet", "sheets"];

    private static string Unit(Material m) => m.Unit.Trim().ToLowerInvariant();
    private static bool Has(Material m, string pattern) => Regex.IsMatch(m.Name, pattern, RegexOptions.IgnoreCase);
    private static bool IsAssembly(Material m) => m.Name.Contains('+') || Has(m, @"\b(repair|fence|w/|removal)\b");

    // Returns true when a default was applied.
    public static bool TryApply(Material m)
    {
        if (m.CalculationType is not null || IsAssembly(m)) return false;
        var unit = Unit(m);

        if (Has(m, @"hollow block|\bchb\b") && Pieces.Contains(unit))
            return Set(m, MaterialCalculationType.UnitArea, length: 400, width: 200, thickness: BlockThickness(m));
        if (Has(m, @"deformed bar|rebar|reinforcing bar") && Pieces.Contains(unit))
            return Set(m, MaterialCalculationType.Length, unitLength: 6.0m);
        if (Has(m, @"portland cement|\bcement\b") && !Has(m, "board|finish|screed|waterproof") && unit == "bag")
            // Class A (1:2:4) concrete ≈ 9 bags per cu.m.
            return Set(m, MaterialCalculationType.Volume, coverage: 0.1111m, coverageUnit: "cu.m");
        if (Has(m, @"\bsand\b") && CubicMeters.Contains(unit))
            return Set(m, MaterialCalculationType.Volume, coverage: 2.0m, coverageUnit: "cu.m"); // 0.5 cu.m sand per cu.m (1:2:4)
        if (Has(m, @"gravel") && !Has(m, "fill") && CubicMeters.Contains(unit))
            return Set(m, MaterialCalculationType.Volume, coverage: 1.0m, coverageUnit: "cu.m"); // 1.0 cu.m gravel per cu.m (1:2:4)
        if (Has(m, @"tile adhesive") && unit == "bag")
            return Set(m, MaterialCalculationType.CoverageRate, coverage: 4.0m, coverageUnit: "sq.m"); // 25 kg bag
        if (Has(m, @"grout") && unit == "bag")
            return Set(m, MaterialCalculationType.CoverageRate, coverage: 5.0m, coverageUnit: "sq.m");
        if (Has(m, @"primer|sealer") && Gallons.Contains(unit))
            return Set(m, MaterialCalculationType.CoverageRate, coverage: 30.0m, coverageUnit: "sq.m", coats: 1);
        if (Has(m, @"\bpaint\b") && Gallons.Contains(unit))
            return Set(m, MaterialCalculationType.CoverageRate, coverage: 25.0m, coverageUnit: "sq.m", coats: 2);
        if (Has(m, @"plywood") && Sheets.Contains(unit))
            return Set(m, MaterialCalculationType.UnitArea, length: 2440, width: 1220);
        if (Has(m, @"fiber cement board|gypsum board|ceiling board") && (SquareMeters.Contains(unit) || Sheets.Contains(unit)))
            return Set(m, MaterialCalculationType.UnitArea, length: 2400, width: 1200,
                purchaseUnit: Sheets.Contains(unit) ? null : "sheet");
        if (Has(m, @"\btile\b") && TileSize(m) is var (l, w) && (SquareMeters.Contains(unit) || Pieces.Contains(unit) || unit == "box"))
        {
            var perBox = TilesPerBox(l, w);
            return Pieces.Contains(unit)
                ? Set(m, MaterialCalculationType.UnitArea, length: l, width: w)
                : Set(m, MaterialCalculationType.UnitArea, length: l, width: w, perPackage: perBox,
                    purchaseUnit: unit == "box" ? null : "box");
        }
        if (Has(m, @"\bdoor\b|\bwindow\b") && (Pieces.Contains(unit) || unit is "set" or "sets"))
            return Set(m, MaterialCalculationType.Count);

        return false;
    }

    private static decimal? BlockThickness(Material m)
    {
        var mm = Regex.Match(m.Name, @"(\d{2,3})\s*mm", RegexOptions.IgnoreCase);
        if (mm.Success) return decimal.Parse(mm.Groups[1].Value);
        var inch = Regex.Match(m.Name, @"(\d)\s*(""|in\b|inch)", RegexOptions.IgnoreCase);
        return inch.Success ? int.Parse(inch.Groups[1].Value) switch { 4 => 100, 5 => 125, 6 => 150, 8 => 200, var n => n * 25 } : null;
    }

    // "600mm x 600mm", "300 x 300mm", "60x60" (cm when both sides ≤ 100).
    private static (decimal, decimal)? TileSize(Material m)
    {
        var match = Regex.Match(m.Name, @"(\d{2,4})\s*(?:mm)?\s*[x×]\s*(\d{2,4})", RegexOptions.IgnoreCase);
        if (!match.Success) return null;
        decimal a = decimal.Parse(match.Groups[1].Value), b = decimal.Parse(match.Groups[2].Value);
        return a <= 100 && b <= 100 ? (a * 10, b * 10) : (a, b);
    }

    private static decimal TilesPerBox(decimal l, decimal w) => (Math.Min(l, w), Math.Max(l, w)) switch
    {
        (600, 600) => 4,
        (300, 600) => 8,
        (400, 400) => 6,
        (300, 300) => 11,
        (200, 200) => 25,
        _ => 1,
    };

    private static bool Set(Material m, MaterialCalculationType type,
        decimal? length = null, decimal? width = null, decimal? thickness = null, decimal? perPackage = null,
        decimal? coverage = null, string? coverageUnit = null, decimal? unitLength = null, int? coats = null,
        string? purchaseUnit = null)
    {
        m.CalculationType = type;
        m.LengthMm = length;
        m.WidthMm = width;
        m.ThicknessMm = thickness;
        m.PiecesPerPackage = perPackage;
        m.CoveragePerUnit = coverage;
        m.CoverageUnit = coverageUnit;
        m.UnitLengthM = unitLength;
        m.Coats = coats;
        m.PurchaseUnit = purchaseUnit;
        m.PropertiesSource = Source;
        return true;
    }
}
