using ConstructIQ.API.Algorithms;
using Xunit;
using Entry = ConstructIQ.API.Algorithms.StockOutSheetRows.Entry;
using SheetMaterial = ConstructIQ.API.Algorithms.StockInSheetRows.SheetMaterial;
using StockInRow = ConstructIQ.API.Algorithms.StockOutSheetRows.StockInRow;

namespace ConstructIQ.Tests;

// Approved redistribution → rows of the warehouse sheet's STOCK OUT (DATE |
// MATERIALS | PROJECT | UNIT | OUT), subtracting from the same balance the
// Excess entry's STOCK IN row added to.
public class StockOutSheetRowsTests
{
    private static readonly SheetMaterial[] Sheet =
    [
        new("Concrete Hollow Block, 100mm, Class A", "pcs"),
        new("THHN Copper Wire, 3.5mm², 150m roll", "roll"),
        new("Portland Cement, 40kg bag", "bag"),
    ];

    private static Entry Transfer(string material, string unit, decimal qty, decimal? logged = null) =>
        new(1, material, unit, qty, "Marianne House", "Amihan", logged);

    [Fact]
    public void DateIsBlank_AndProjectIsTheTarget()
    {
        var (rows, skipped) = StockOutSheetRows.Build([Transfer("Portland Cement, 40kg bag", "bag", 5)], Sheet, []);

        Assert.Empty(skipped);
        Assert.Equal(["", "Portland Cement, 40kg bag", "Marianne House", "bag", 5m], Assert.Single(rows).Values);
    }

    [Fact]
    public void CopiesTheStockInRowsCorrectedName_EvenInAnotherUnitThanTheBalance()
    {
        // Someone picked the warehouse's name on the IN row but left it in l.m:
        // the OUT has to cancel exactly what that row added.
        StockInRow[] stockIn = [new("THHN Copper Wire, 3.5mm², 150m roll", "Excess from Amihan", "l.m", 12)];

        var (rows, skipped) = StockOutSheetRows.Build([Transfer("THHN Wire w/ Conduit", "l.m", 12, logged: 12)], Sheet, stockIn);

        Assert.Empty(skipped);
        var row = Assert.Single(rows);
        Assert.Equal("THHN Copper Wire, 3.5mm², 150m roll", row.Values[1]);
        Assert.Equal("l.m", row.Values[3]);
        Assert.Null(row.Note);
    }

    [Fact]
    public void PartialTransfer_StillFindsTheRowByTheLoggedQuantity()
    {
        StockInRow[] stockIn = [new("Concrete Hollow Block, 100mm, Class A", "Excess from Amihan", "pc", 50)];

        var row = Assert.Single(StockOutSheetRows.Build([Transfer("CHB (100mm) + Plaster", "pc", 20, logged: 50)], Sheet, stockIn).Rows);

        Assert.Equal("Concrete Hollow Block, 100mm, Class A", row.Values[1]);
        Assert.Equal(20m, row.Values[4]);
    }

    [Fact]
    public void AmbiguousStockInRows_AreNotGuessedAt()
    {
        StockInRow[] stockIn =
        [
            new("Concrete Hollow Block, 100mm, Class A", "Excess from Amihan", "pc", 50),
            new("Some Other Block", "Excess from Amihan", "pc", 50),
        ];

        var row = Assert.Single(StockOutSheetRows.Build([Transfer("CHB (100mm) + Plaster", "pc", 50, logged: 50)], Sheet, stockIn).Rows);

        Assert.Equal("CHB (100mm) + Plaster", row.Values[1]);
        Assert.Contains("STOCK BALANCE", row.Note);
    }

    [Fact]
    public void WithoutAStockInRow_UsesTheSameRulesAsExcess()
    {
        var (rows, skipped) = StockOutSheetRows.Build([Transfer("Portland Cement, 40kg bag", "kg", 5)], Sheet, []);

        Assert.Empty(rows);
        Assert.Contains("bag", Assert.Single(skipped).Reason);
    }

    [Fact]
    public void AnotherProjectsRow_IsNotUsed()
    {
        StockInRow[] stockIn = [new("Some Other Block", "Excess from Almeda Residence", "pc", 50)];

        var row = Assert.Single(StockOutSheetRows.Build([Transfer("CHB (100mm) + Plaster", "pc", 50, logged: 50)], Sheet, stockIn).Rows);

        Assert.Equal("CHB (100mm) + Plaster", row.Values[1]);
    }
}
