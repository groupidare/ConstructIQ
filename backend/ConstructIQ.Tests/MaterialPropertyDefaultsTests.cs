using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Models.Entities;
using Xunit;

namespace ConstructIQ.Tests;

// Names/units taken from the real catalog, so the done-criterion "CHB, tiles,
// boards, adhesive, grout, paint, cement, sand, gravel, rebar have
// properties" is checked against what's actually in it.
public class MaterialPropertyDefaultsTests
{
    [Theory]
    [InlineData("Concrete Hollow Block, 100mm, Class A", "pc", MaterialCalculationType.UnitArea)]
    [InlineData("Hollow Blocks 6\"", "pcs", MaterialCalculationType.UnitArea)]
    [InlineData("Deformed Bar 12mm", "pcs", MaterialCalculationType.Length)]
    [InlineData("Portland Cement", "bag", MaterialCalculationType.Volume)]
    [InlineData("Screened Sand", "cu.m", MaterialCalculationType.Volume)]
    [InlineData("Washed Sand", "m3", MaterialCalculationType.Volume)]
    [InlineData("Crushed Gravel", "m3", MaterialCalculationType.Volume)]
    [InlineData("Tile Adhesive", "bag", MaterialCalculationType.CoverageRate)]
    [InlineData("Tile Grout", "bag", MaterialCalculationType.CoverageRate)]
    [InlineData("Paint - Flatwall Latex", "can", MaterialCalculationType.CoverageRate)]
    [InlineData("Concrete Primer/Sealer, 1 gallon", "gal", MaterialCalculationType.CoverageRate)]
    [InlineData("Marine Plywood 1/2\"", "sht", MaterialCalculationType.UnitArea)]
    [InlineData("Fiber Cement Board (4.5mm thick)", "sq.m", MaterialCalculationType.UnitArea)]
    [InlineData("Gypsum Board (12mm thick) on metal furring", "sq.m", MaterialCalculationType.UnitArea)]
    [InlineData("Homogeneous Tile (600mm x 600mm, 10mm thick)", "sq.m", MaterialCalculationType.UnitArea)]
    [InlineData("Ceramic Floor Tile 60x60", "sqm", MaterialCalculationType.UnitArea)]
    [InlineData("900 x 2100mm flush/solid core door", "pc", MaterialCalculationType.Count)]
    public void CommonMaterials_GetDefaults(string name, string unit, MaterialCalculationType expected)
    {
        var material = new Material { Name = name, Unit = unit };

        Assert.True(MaterialPropertyDefaults.TryApply(material));
        Assert.Equal(expected, material.CalculationType);
        Assert.Equal(MaterialPropertyDefaults.Source, material.PropertiesSource);
    }

    [Theory]
    [InlineData("CHB (100mm) + Plaster (15mm) + Paint Finish", "sq.m")]   // an assembly, already in work units
    [InlineData("Existing CHB wall repair + skim coat + repaint", "sq.m")]
    [InlineData("Gravel Fill (150mm thick), compacted", "sq.m")]
    [InlineData("Latex Paint, 2 coats + primer", "sq.m")]
    [InlineData("Deformed Steel Reinforcing Bar, 20mm x 6m", "sq.m")]    // wrong catalog unit — left for an Admin
    public void AssembliesAndWorkUnitRows_AreLeftAlone(string name, string unit)
    {
        var material = new Material { Name = name, Unit = unit };

        Assert.False(MaterialPropertyDefaults.TryApply(material));
        Assert.Null(material.CalculationType);
    }

    [Fact]
    public void ExistingProperties_AreNeverOverwritten()
    {
        var material = new Material { Name = "Tile Adhesive", Unit = "bag", CalculationType = MaterialCalculationType.CoverageRate, CoveragePerUnit = 3.5m };

        Assert.False(MaterialPropertyDefaults.TryApply(material));
        Assert.Equal(3.5m, material.CoveragePerUnit);
    }

    [Fact]
    public void BoardDefault_ProducesTheSheetBaseline()
    {
        var board = new Material { Name = "Fiber Cement Board", Unit = "sq.m" };
        MaterialPropertyDefaults.TryApply(board);

        var result = BaselineCalculator.Compute(BaselineMaterial.From(board), "sq.m", 708.5m);

        Assert.Equal("sheet", result.PurchaseUnit);
        Assert.Equal(247, result.PurchaseQuantity);
        Assert.Equal("708.5 m² ÷ 2.88 m²/sheet", result.FormulaText);
    }

    [Fact]
    public void ChbDefault_Is12Point5PerSquareMeter()
    {
        var chb = new Material { Name = "Concrete Hollow Block, 150mm, Class A", Unit = "pc" };
        MaterialPropertyDefaults.TryApply(chb);

        Assert.Equal(150m, chb.ThicknessMm);
        Assert.Equal(12.5m, BaselineCalculator.Compute(BaselineMaterial.From(chb), "sq.m", 1m).BaselineQuantity);
    }
}
