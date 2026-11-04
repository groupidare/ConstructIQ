using ConstructIQ.API.Algorithms;
using Xunit;
using Entry = ConstructIQ.API.Algorithms.StockInSheetRows.ExcessEntry;
using SheetMaterial = ConstructIQ.API.Algorithms.StockInSheetRows.SheetMaterial;

namespace ConstructIQ.Tests;

// Logged Excess → rows of the warehouse sheet's STOCK IN (DATE | MATERIALS |
// SUPPLIER | UNIT | IN). The sheet's BAL formula matches on the exact
// MATERIALS text, so the sheet's own spelling must be written.
public class StockInSheetRowsTests
{
    private static readonly SheetMaterial[] Sheet =
    [
        new("Concrete Hollow Block, 100mm, Class A", "pcs"),
        new("Homogeneous Floor Tile, 600mm x 600mm, 10mm thick", "box"),
    ];

    private static Entry Excess(string material, string unit, decimal qty, DateTime? at = null) =>
        new(1, at ?? new DateTime(2026, 11, 3, 4, 0, 0, DateTimeKind.Utc), material, unit, qty, "Almeda Residence");

    [Fact]
    public void MatchedMaterial_UsesTheSheetsSpellingAndUnit()
    {
        var (rows, skipped) = StockInSheetRows.Build([Excess("  concrete hollow block,  100mm, CLASS A ", "pc", 150)], Sheet);

        Assert.Empty(skipped);
        var row = Assert.Single(rows);
        Assert.Equal(["2026-11-03", "Concrete Hollow Block, 100mm, Class A", "Excess from Almeda Residence", "pcs", 150m], row.Values);
        Assert.Null(row.Note);
    }

    [Fact]
    public void SameMaterialInAnotherUnit_IsSkippedNotAddedToTheWrongBalance()
    {
        var (rows, skipped) = StockInSheetRows.Build([Excess("Homogeneous Floor Tile, 600mm x 600mm, 10mm thick", "sq.m", 10)], Sheet);

        Assert.Empty(rows);
        Assert.Contains("box", Assert.Single(skipped).Reason);
    }

    [Fact]
    public void MaterialNotOnTheSheet_IsStillWrittenWithANote()
    {
        var (rows, skipped) = StockInSheetRows.Build([Excess("Latex Paint", "gal", 2)], Sheet);

        Assert.Empty(skipped);
        var row = Assert.Single(rows);
        Assert.Equal("Latex Paint", row.Values[1]);
        Assert.Equal("gal", row.Values[3]);
        Assert.Contains("STOCK BALANCE", row.Note);
    }

    [Fact]
    public void Date_IsThePhilippineDate()
    {
        // 17:30 UTC on Nov 2 is 1:30 a.m. on Nov 3 in Manila.
        var (rows, _) = StockInSheetRows.Build([Excess("Latex Paint", "gal", 1, new DateTime(2026, 11, 2, 17, 30, 0, DateTimeKind.Utc))], Sheet);

        Assert.Equal("2026-11-03", Assert.Single(rows).Values[0]);
    }

    [Fact]
    public void WorkItemName_FallsBackToThePurchasedMaterialInTheSameUnit()
    {
        var entry = Excess("CHB (100mm) + Plaster (15mm) + Paint Finish", "pc", 50) with
        {
            PurchasedAs = [new("Concrete Hollow Block, 100mm, Class A", "pcs"), new("Portland Cement", "bag")],
        };
        var (rows, skipped) = StockInSheetRows.Build([entry], Sheet);

        Assert.Empty(skipped);
        var row = Assert.Single(rows);
        Assert.Equal("Concrete Hollow Block, 100mm, Class A", row.Values[1]);
        Assert.Null(row.Note);
    }

    [Fact]
    public void UnmatchedWorkItem_IsWrittenUnderThePurchasedName()
    {
        var entry = Excess("CHB (100mm) + Plaster (15mm) + Paint Finish", "pc", 50) with
        {
            PurchasedAs = [new("CHB, 100mm thick, Class A", "pc"), new("Portland Cement", "bag")],
        };
        var row = Assert.Single(StockInSheetRows.Build([entry], Sheet).Rows);

        Assert.Equal("CHB, 100mm thick, Class A", row.Values[1]);
        Assert.NotNull(row.Note);
    }

    [Fact]
    public void ZeroQuantity_IsSkipped()
    {
        var (rows, skipped) = StockInSheetRows.Build([Excess("Latex Paint", "gal", 0)], Sheet);

        Assert.Empty(rows);
        Assert.Single(skipped);
    }
}
