using ConstructIQ.API.Algorithms;
using Xunit;
using Run = ConstructIQ.API.Algorithms.CompletedProjectDemandRules.ForecastRun;

namespace ConstructIQ.Tests;

// Pure rules behind the Forecasting chart's completed-projects view, no database.
public class CompletedProjectDemandRulesTests
{
    private static readonly DateTime Completion = new(2026, 6, 20);

    [Fact]
    public void ResolveCompletionDate_PrefersFirstFullProgressUpdate()
    {
        var date = CompletedProjectDemandRules.ResolveCompletionDate(new DateTime(2026, 6, 20), new DateTime(2026, 3, 31));
        Assert.Equal(new DateTime(2026, 6, 20), date);
    }

    [Fact]
    public void ResolveCompletionDate_FallsBackToTargetEndDate()
    {
        var date = CompletedProjectDemandRules.ResolveCompletionDate(null, new DateTime(2024, 8, 31));
        Assert.Equal(new DateTime(2024, 8, 31), date);
    }

    [Fact]
    public void ToMonth_BucketsToFirstOfMonth()
    {
        Assert.Equal(new DateTime(2026, 6, 1), CompletedProjectDemandRules.ToMonth(new DateTime(2026, 6, 20, 14, 30, 0)));
    }

    [Fact]
    public void SelectForecastRuns_LatestWholeProjectRunWins_PhaseRunsIgnored()
    {
        var runs = new[]
        {
            new Run(1, null, new DateTime(2026, 2, 1)),
            new Run(2, null, new DateTime(2026, 4, 1)),
            new Run(3, 7,    new DateTime(2026, 5, 1)),
        };
        Assert.Equal([2], CompletedProjectDemandRules.SelectForecastRuns(runs, Completion));
    }

    [Fact]
    public void SelectForecastRuns_NoWholeProjectRun_TakesLatestPerPhase()
    {
        var runs = new[]
        {
            new Run(1, 7, new DateTime(2026, 2, 1)),
            new Run(2, 7, new DateTime(2026, 3, 1)),
            new Run(3, 8, new DateTime(2026, 4, 1)),
        };
        Assert.Equal([2, 3], CompletedProjectDemandRules.SelectForecastRuns(runs, Completion).OrderBy(id => id));
    }

    [Fact]
    public void SelectForecastRuns_IgnoresRunsOnOrAfterCompletion()
    {
        var runs = new[]
        {
            new Run(1, null, new DateTime(2026, 2, 1)),
            new Run(2, null, Completion),
            new Run(3, null, new DateTime(2026, 7, 1)),
        };
        Assert.Equal([1], CompletedProjectDemandRules.SelectForecastRuns(runs, Completion));
    }

    [Fact]
    public void SelectForecastRuns_WholeProjectRunAfterCompletion_FallsBackToEarlierPhaseRuns()
    {
        var runs = new[]
        {
            new Run(1, 7,    new DateTime(2026, 3, 1)),
            new Run(2, null, new DateTime(2026, 7, 1)), // too late, doesn't count
        };
        Assert.Equal([1], CompletedProjectDemandRules.SelectForecastRuns(runs, Completion));
    }

    [Fact]
    public void SelectForecastRuns_NothingBeforeCompletion_ReturnsEmpty()
    {
        var runs = new[] { new Run(1, null, new DateTime(2026, 8, 1)) };
        Assert.Empty(CompletedProjectDemandRules.SelectForecastRuns(runs, Completion));
    }

    [Theory]
    [InlineData(" PCS ", "pc")]
    [InlineData("Pieces", "pc")]
    [InlineData("Bag", "bag")]
    [InlineData(null, "")]
    public void NormalizeUnit_FoldsCaseWhitespaceAndPieceVariants(string? raw, string expected)
    {
        Assert.Equal(expected, CompletedProjectDemandRules.NormalizeUnit(raw));
    }
}
