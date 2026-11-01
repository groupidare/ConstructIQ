using System.Globalization;
using ConstructIQ.API.Models.Entities;

namespace ConstructIQ.API.Algorithms;

// Engineering baseline — how many purchase units physically cover a BOQ work
// quantity. Mirror of ml-service/app/ml/baseline_engine.py (the source of
// truth); both run the shared cases in ml-service/tests/fixtures/
// baseline_cases.json. Used for the Est. Qty tooltip and alerts only — it's
// never stored and never shown as its own column. No waste allowance: the ML
// learns real waste on top of this.
public record BaselineMaterial(
    string Unit,
    MaterialCalculationType? CalculationType,
    decimal? LengthMm = null, decimal? WidthMm = null, decimal? ThicknessMm = null,
    decimal? PiecesPerPackage = null, decimal? CoveragePerUnit = null, string? CoverageUnit = null,
    decimal? UnitLengthM = null, int? Coats = null, string? PurchaseUnit = null)
{
    public static BaselineMaterial From(Material m) => new(
        m.Unit, m.CalculationType, m.LengthMm, m.WidthMm, m.ThicknessMm, m.PiecesPerPackage,
        m.CoveragePerUnit, m.CoverageUnit, m.UnitLengthM, m.Coats, m.PurchaseUnit);
}

public record BaselineResult(
    decimal? BaselineQuantity, int? PurchaseQuantity, string? PurchaseUnit, string? FormulaText, string? Reason)
{
    public bool Available => BaselineQuantity.HasValue;
    public static BaselineResult Unavailable(string reason) => new(null, null, null, null, reason);
}

public static class BaselineCalculator
{
    public const string NoProperties = "no properties";
    public const string UnitMismatch = "unit mismatch";
    public const string NeedsVolume  = "needs thickness/volume";
    public const string NoQuantity   = "no quantity";

    private static readonly Dictionary<string, HashSet<string>> WorkUnits = new()
    {
        ["area"]   = ["sq.m", "sqm", "sq m", "sq. m", "sq.m.", "m2", "m²", "sq.m coverage", "square meter", "square meters"],
        ["volume"] = ["cu.m", "cum", "cu m", "cu. m", "cu.m.", "m3", "m³", "cbm", "cubic meter", "cubic meters"],
        ["length"] = ["l.m", "lm", "l.m.", "m", "meter", "meters", "linear meter", "linear meters", "lin.m"],
        ["count"]  = ["pc", "pcs", "piece", "pieces", "set", "sets", "unit", "units", "ea", "each", "nos", "no."],
    };

    private static string RequiredWorkUnit(MaterialCalculationType t) => t switch
    {
        MaterialCalculationType.UnitArea or MaterialCalculationType.CoverageRate => "area",
        MaterialCalculationType.Volume => "volume",
        MaterialCalculationType.Count => "count",
        _ => "length",
    };

    // "area" | "volume" | "length" | "count" | null (unrecognized).
    public static string? WorkUnitKind(string? unit)
    {
        var u = string.Join(' ', (unit ?? string.Empty).Trim().ToLowerInvariant()
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return WorkUnits.FirstOrDefault(kv => kv.Value.Contains(u)).Key;
    }

    private static readonly Dictionary<string, string> PurchaseUnitAliases = new()
    {
        ["pc"] = "pc", ["pcs"] = "pc", ["piece"] = "pc", ["pieces"] = "pc",
        ["sht"] = "sheet", ["sheet"] = "sheet", ["sheets"] = "sheet",
        ["gal"] = "gal", ["gallon"] = "gal", ["gallons"] = "gal",
        ["bag"] = "bag", ["bags"] = "bag", ["box"] = "box", ["boxes"] = "box",
        ["set"] = "set", ["sets"] = "set", ["roll"] = "roll", ["rolls"] = "roll",
        ["pail"] = "pail", ["pails"] = "pail", ["can"] = "can", ["cans"] = "can",
    };

    // Folds label variants of one purchase unit (sht/sheet, pcs/pc, …) so a
    // row's Est. Qty unit can be compared with the baseline's unit. Same as
    // Python's purchase_unit_key().
    public static string PurchaseUnitKey(string? unit)
    {
        var u = (unit ?? string.Empty).Trim().ToLowerInvariant();
        if (PurchaseUnitAliases.TryGetValue(u, out var key)) return key;
        return WorkUnitKind(u) switch { "area" => "sq.m", "volume" => "cu.m", "length" => "l.m", _ => u };
    }

    // Up to 4 decimals, no trailing zeros — same as Python's fmt().
    public static string Fmt(decimal x) => Math.Round(x, 4).ToString("0.####", CultureInfo.InvariantCulture);

    private static decimal? Positive(decimal? v) => v is > 0 ? v : null;

    public const string AlertFarFromExpected = "far_from_expected";
    public const string AlertUnitMismatch    = "unit_mismatch";
    public const string AlertMissingProps    = "missing_properties";
    public const string AlertNeedsVolume     = "needs_volume";
    public const decimal FarFromExpectedTolerance = 0.25m;

    // Material Plan alerts for one row: why there's no baseline, or how the
    // row's Est. Qty compares with it (more than ±25% off = far from expected).
    public static List<string> Alerts(BaselineResult baseline, decimal? estimatedPurchaseQuantity, string? estimatedPurchaseUnit)
    {
        switch (baseline.Reason)
        {
            case NoProperties: return [AlertMissingProps];
            case UnitMismatch: return [AlertUnitMismatch];
            case NeedsVolume:  return [AlertNeedsVolume];
            case not null:     return [];
        }
        if (estimatedPurchaseQuantity is not > 0 || baseline.BaselineQuantity is not > 0)
            return [];
        if (!string.IsNullOrWhiteSpace(estimatedPurchaseUnit)
            && PurchaseUnitKey(estimatedPurchaseUnit) != PurchaseUnitKey(baseline.PurchaseUnit))
            return [AlertUnitMismatch];
        var deviation = Math.Abs(estimatedPurchaseQuantity.Value - baseline.BaselineQuantity.Value) / baseline.BaselineQuantity.Value;
        return deviation > FarFromExpectedTolerance ? [AlertFarFromExpected] : [];
    }

    public static BaselineResult Compute(BaselineMaterial material, string? boqUnit, decimal? boqQuantity)
    {
        if (material.CalculationType is not { } calc)
            return BaselineResult.Unavailable(NoProperties);

        var length = Positive(material.LengthMm);
        var width = Positive(material.WidthMm);
        var perPackage = Positive(material.PiecesPerPackage) ?? 1m;
        var coverage = Positive(material.CoveragePerUnit);
        var unitLength = Positive(material.UnitLengthM);
        var coats = material.Coats is > 0 ? material.Coats.Value : 1;
        if ((calc == MaterialCalculationType.UnitArea && (length is null || width is null))
            || (calc is MaterialCalculationType.CoverageRate or MaterialCalculationType.Volume && coverage is null)
            || (calc == MaterialCalculationType.Length && unitLength is null))
            return BaselineResult.Unavailable(NoProperties);

        var kind = WorkUnitKind(boqUnit);
        var required = RequiredWorkUnit(calc);
        if (kind != required)
            return BaselineResult.Unavailable(required == "volume" && kind == "area" ? NeedsVolume : UnitMismatch);

        if (boqQuantity is not { } qty || qty < 0)
            return BaselineResult.Unavailable(NoQuantity);
        var unit = (string.IsNullOrWhiteSpace(material.PurchaseUnit) ? material.Unit : material.PurchaseUnit).Trim();

        decimal raw;
        string formula;
        switch (calc)
        {
            case MaterialCalculationType.UnitArea:
                var face = Math.Round(length!.Value * width!.Value / 1_000_000m, 6);
                raw = qty / face / perPackage;
                formula = $"{Fmt(qty)} m² ÷ {Fmt(face)} m²/{(perPackage > 1 ? "pc" : unit)}"
                    + (perPackage > 1 ? $" ÷ {Fmt(perPackage)} pc/{unit}" : "");
                break;
            case MaterialCalculationType.CoverageRate:
                raw = qty * coats / coverage!.Value;
                formula = $"{Fmt(qty)} m²" + (coats > 1 ? $" × {coats} coats" : "") + $" ÷ {Fmt(coverage.Value)} m²/{unit}";
                break;
            case MaterialCalculationType.Volume:
                raw = qty / coverage!.Value;
                formula = $"{Fmt(qty)} m³ ÷ {Fmt(coverage.Value)} m³/{unit}";
                break;
            case MaterialCalculationType.Count:
                raw = qty / perPackage;
                formula = $"{Fmt(qty)} pc" + (perPackage > 1 ? $" ÷ {Fmt(perPackage)} pc/{unit}" : "");
                break;
            default:
                raw = qty / unitLength!.Value;
                formula = $"{Fmt(qty)} m ÷ {Fmt(unitLength.Value)} m/{unit}";
                break;
        }

        var baseline = Math.Round(raw, 4);
        return new BaselineResult(baseline, (int)Math.Ceiling(baseline - 0.000001m), unit, formula, null);
    }
}
