using ConstructIQ.API.Algorithms;
using Xunit;

namespace ConstructIQ.Tests;

public class MaterialNameMatchTests
{
    [Theory]
    [InlineData("300mm x 300mm Ceramic Floor Tiles (FF-2), T&B", "Non-slip Ceramic Floor Tile, 300mm x 300mm, 8mm thick", true)]
    [InlineData("Cementitious Tile Grout, 5kg pack", "Tile Grout, 5kg/pack", true)]
    // Different size: not the same product.
    [InlineData("300mm x 300mm Ceramic Floor Tiles (FF-2), T&B", "Homogeneous Floor Tile, 600mm x 600mm", false)]
    [InlineData("LED Ceiling Light, 18W", "Fiber Cement Board, 4.5mm x 1.2m x 2.4m", false)]
    public void Similar(string a, string b, bool expected) =>
        Assert.Equal(expected, MaterialNameMatch.IsSimilar(a, b));

    [Theory]
    [InlineData("Cementitious Tile Grout, 5kg pack", "Homogeneous Floor Tile, 600mm x 600mm", true)]
    [InlineData("Primer + 2 coats low-VOC latex", "Interior Acrylic Latex Topcoat Paint, 1 gallon", true)]
    // "Ceiling" in both, but a light and a board aren't the same kind.
    [InlineData("LED Ceiling Light, 18W", "Gypsum Ceiling Board, 9mm", false)]
    public void SameKind(string a, string b, bool expected) =>
        Assert.Equal(expected, MaterialNameMatch.IsSameKind(a, b));

    [Theory]
    [InlineData("CircuitPro Electrical Trading", "CircuitPro Electrical Trading Corp.")]
    [InlineData("CircuitPro Electrical Trading B", "CircuitPro Electrical Trading C")]
    [InlineData("MechSafe Systems Philippines A", "MechSafe Systems Philippines, Inc.")]
    [InlineData("JS Builders Hardware & Construction Supply", "JS Builders Hardware and Construction Supply, Inc.")]
    public void SupplierSpellings_ShareAKey(string a, string b) =>
        Assert.Equal(MaterialNameMatch.SupplierKey(a), MaterialNameMatch.SupplierKey(b));
}
