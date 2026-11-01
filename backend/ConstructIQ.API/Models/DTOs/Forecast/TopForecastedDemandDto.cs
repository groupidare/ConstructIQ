namespace ConstructIQ.API.Models.DTOs.Forecast;

// Powers the dashboard's "Top Forecasted Material Demand" panel. A snapshot
// of the latest saved forecast per eligible project - never a sum of every
// forecast run ever generated for a project (see ForecastService for the
// selection rule). Deliberately company-wide: unlike BOQService's
// per-project cross-project queries (which expose individual project
// figures and so are scoped by ownership), this endpoint only ever returns
// an aggregate top-5 ranking, so every authenticated role sees the same
// numbers regardless of which projects they're assigned to.
public class TopForecastedDemandDto
{
    public List<string> AvailableUnits { get; set; } = [];

    // Null only when there is no positive forecasted demand in any unit at
    // all (no eligible forecasts, or every forecasted quantity is <= 0).
    public string? SelectedUnit { get; set; }

    // Every Planning/Active, non-historical project company-wide.
    public int EligibleProjectCount { get; set; }

    // Of EligibleProjectCount, how many contributed a usable latest forecast.
    public int ProjectsWithForecastCount { get; set; }

    // Of ProjectsWithForecastCount, how many had ONLY phase-scoped forecasts
    // (no project-wide forecast) - their single latest phase forecast was
    // used, but it does not represent complete project coverage.
    public int PhaseOnlyProjectCount { get; set; }

    // True when no active (Planning/Active, non-historical) project has ever
    // had a forecast generated, so Materials below is instead built from
    // real, genuine forecast output saved against historical/completed
    // reference projects - never a substitute figure, just a different
    // project scope. EligibleProjectCount/ProjectsWithForecastCount/
    // PhaseOnlyProjectCount above still describe the ACTIVE scope (honestly
    // showing 0 forecasts) even when this is true - they are never swapped
    // for the fallback scope's own numbers.
    public bool UsedHistoricalFallback { get; set; }

    // Only meaningful when UsedHistoricalFallback is true: how many
    // historical/completed reference projects actually contributed to
    // Materials below.
    public int HistoricalProjectsWithForecastCount { get; set; }

    public List<TopForecastedMaterialDto> Materials { get; set; } = [];
}

public class TopForecastedMaterialDto
{
    public int Rank { get; set; }
    public int MaterialId { get; set; }
    public string MaterialName { get; set; } = string.Empty;
    public string Specification { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;
    public decimal TotalForecastedQuantity { get; set; }
    public int ContributingProjectCount { get; set; }
    public List<ForecastContributionDto> Contributions { get; set; } = [];
}

public class ForecastContributionDto
{
    public int ProjectId { get; set; }
    public string ProjectName { get; set; } = string.Empty;
    public decimal ForecastedQuantity { get; set; }
    public DateTime GeneratedAt { get; set; }
    public string Period { get; set; } = string.Empty;
    public bool IsPhaseScoped { get; set; }
}
