using ConstructIQ.API.Algorithms;
using Xunit;

namespace ConstructIQ.Tests;

// Pure arithmetic/validation, no database — cases 1, 3, 5, 6, 7 from the
// forecasting-rework spec.
public class ActualUsageCalculatorTests
{
    [Fact] // Case 1: 500 estimated - 50 excess - 20 waste = 430 actual usage.
    public void Calculate_BasicDeduction_ReturnsExpectedUsage()
    {
        var result = ActualUsageCalculator.Calculate(500, 50, 20);
        Assert.True(result.IsValid);
        Assert.Equal(430, result.ActualUsage);
    }

    [Fact] // Case 3: explicit zero excess and zero waste means Actual Usage = Estimated Quantity.
    public void Calculate_ExplicitZeroExcessAndWaste_EqualsEstimated()
    {
        var result = ActualUsageCalculator.Calculate(500, 0, 0);
        Assert.True(result.IsValid);
        Assert.Equal(500, result.ActualUsage);
    }

    [Fact] // Case 5: combined excess and waste equal to estimate producing valid zero usage (not clamped-as-error).
    public void Calculate_DeductionsEqualEstimate_ReturnsValidZero()
    {
        var result = ActualUsageCalculator.Calculate(100, 60, 40);
        Assert.True(result.IsValid);
        Assert.Equal(0, result.ActualUsage);
    }

    [Fact] // Case 6: combined deductions exceeding estimate is flagged invalid, never silently clamped to zero.
    public void Calculate_DeductionsExceedEstimate_IsInvalidNotClamped()
    {
        var result = ActualUsageCalculator.Calculate(100, 70, 50);
        Assert.False(result.IsValid);
        Assert.Null(result.ActualUsage);
        Assert.NotNull(result.ErrorMessage);
    }

    [Theory] // Case 7: negative input quantities are rejected, not treated as valid.
    [InlineData(-1, 10, 10)]
    [InlineData(100, -5, 10)]
    [InlineData(100, 10, -5)]
    public void Calculate_NegativeInputs_IsInvalid(decimal estimated, decimal excess, decimal waste)
    {
        var result = ActualUsageCalculator.Calculate(estimated, excess, waste);
        Assert.False(result.IsValid);
        Assert.Null(result.ActualUsage);
    }
}
