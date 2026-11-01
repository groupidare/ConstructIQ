using System.Text.Json;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Models.Entities;
using Xunit;

namespace ConstructIQ.Tests;

// Runs the same fixture as ml-service/tests/test_baseline_engine.py, so the C#
// mirror can't drift from the Python source of truth.
public class BaselineCalculatorTests
{
    public static IEnumerable<object[]> SharedCases()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "ml-service", "tests", "fixtures", "baseline_cases.json")))
            dir = dir.Parent;
        if (dir is null) throw new InvalidOperationException("Shared baseline fixture not found — run from within the repo.");

        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir.FullName, "ml-service", "tests", "fixtures", "baseline_cases.json")));
        foreach (var c in doc.RootElement.GetProperty("cases").EnumerateArray())
            yield return [c.GetProperty("name").GetString()!, c.GetRawText()];
    }

    [Theory]
    [MemberData(nameof(SharedCases))]
    public void SharedFixtureCase(string name, string caseJson)
    {
        using var doc = JsonDocument.Parse(caseJson);
        var c = doc.RootElement;
        var m = c.GetProperty("material");
        var material = new BaselineMaterial(
            Str(m, "unit") ?? "",
            Str(m, "calculation_type") is { } t ? Enum.Parse<MaterialCalculationType>(t) : null,
            Dec(m, "length_mm"), Dec(m, "width_mm"), Dec(m, "thickness_mm"), Dec(m, "pieces_per_package"),
            Dec(m, "coverage_per_unit"), Str(m, "coverage_unit"), Dec(m, "unit_length_m"),
            m.TryGetProperty("coats", out var coats) ? coats.GetInt32() : null, Str(m, "purchase_unit"));

        var result = BaselineCalculator.Compute(material, Str(c, "boq_unit"), Dec(c, "boq_quantity"));
        var e = c.GetProperty("expected");

        Assert.True(Dec(e, "baseline_quantity") == result.BaselineQuantity, $"{name}: baseline {result.BaselineQuantity}");
        Assert.Equal(e.GetProperty("purchase_quantity").ValueKind == JsonValueKind.Null ? null : e.GetProperty("purchase_quantity").GetInt32(), result.PurchaseQuantity);
        Assert.Equal(Str(e, "purchase_unit"), result.PurchaseUnit);
        Assert.Equal(Str(e, "formula_text"), result.FormulaText);
        Assert.Equal(Str(e, "reason"), result.Reason);
    }

    private static string? Str(JsonElement e, string key) =>
        e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static decimal? Dec(JsonElement e, string key) =>
        e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : null;
}
