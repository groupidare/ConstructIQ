namespace ConstructIQ.API.Algorithms;

// Pure, DB-free rules behind the Forecasting chart's "completed projects
// only" view — kept out of BOQService's EF Core queries so they can be
// unit-tested directly, the same way ActualUsageCalculator is.
//
// Every completed project lands in exactly ONE month (its completion month),
// and both its Actual Usage and its AI Predicted figures land there together,
// so the two lines always compare the same projects in the same month.
public static class CompletedProjectDemandRules
{
    // A real project's completion is the first progress update that reached
    // 100% (that's the moment ProjectService flips it to Completed). A project
    // backfilled via "Add Completed Project" never logs one, so its own
    // TargetEndDate — the end date typed in when it was entered — stands in.
    public static DateTime ResolveCompletionDate(DateTime? firstFullProgressAt, DateTime targetEndDate) =>
        firstFullProgressAt ?? targetEndDate;

    public static DateTime ToMonth(DateTime date) => new(date.Year, date.Month, 1);

    // The unit a BOQ line's quantity is actually in: its purchase unit when
    // the purchase-unit baseline is the one in use (pass null otherwise),
    // else the row's own unit, else the catalog Material's unit — the same
    // purchase-unit-first order the ML service labels its forecasts with
    // (see forecasting_service.py's _resolve_output_unit).
    public static string ResolveBoqLineUnit(string? purchaseUnit, string? rowUnit, string materialUnit) =>
        !string.IsNullOrWhiteSpace(purchaseUnit) ? purchaseUnit.Trim()
        : !string.IsNullOrWhiteSpace(rowUnit) ? rowUnit.Trim()
        : materialUnit;

    public readonly record struct ForecastRun(int ForecastResultId, int? PhaseId, DateTime GeneratedAt);

    // Which of one project's forecast runs count toward its AI Predicted
    // figure. Only runs generated BEFORE the project finished qualify — a run
    // made afterward (e.g. on a backfilled project, after its actuals were
    // already typed in) isn't a prediction of anything. Of those, the latest
    // whole-project run (PhaseId null) wins on its own; only when there is no
    // whole-project run does the latest run per phase get summed instead.
    // Never both — a whole-project run already covers every phase, so adding
    // phase runs on top would double-count the same materials.
    public static IReadOnlyList<int> SelectForecastRuns(IEnumerable<ForecastRun> runs, DateTime completionDate)
    {
        var qualifying = runs.Where(r => r.GeneratedAt < completionDate).ToList();

        var wholeProject = qualifying.Where(r => r.PhaseId is null).ToList();
        if (wholeProject.Count > 0)
            return [Latest(wholeProject).ForecastResultId];

        return qualifying
            .GroupBy(r => r.PhaseId)
            .Select(g => Latest(g).ForecastResultId)
            .ToList();
    }

    private static ForecastRun Latest(IEnumerable<ForecastRun> runs) =>
        runs.OrderByDescending(r => r.GeneratedAt).ThenByDescending(r => r.ForecastResultId).First();

    public readonly record struct ForecastRow(int ForecastResultId, DateTime GeneratedAt, bool IsSeeded, int MaterialId, string Unit, decimal Quantity);

    // A backfilled historical project (entered via "Add Completed Project")
    // only ever gets forecast AFTER it was entered, so SelectForecastRuns'
    // before-completion rule would leave it with nothing. Its AI Predicted
    // figure is instead the model's evaluation on that project — any run
    // date counts — picked per material+unit rather than per run:
    //  - Real model runs (Generate Forecast) win whenever one covers the
    //    material: the rows from the latest such run that includes it.
    //  - Otherwise, seeded runs (DbInitializer.SeedHistoricalForecastsAsync)
    //    are all summed — that seeder writes one run per BOQ line, never
    //    re-runs one, so each seeded run is a different line, not a newer
    //    version of the same figure.
    // `rows` are one project's forecast rows.
    public static IReadOnlyList<ForecastRow> SelectHistoricalForecastRows(IEnumerable<ForecastRow> rows) =>
        rows.GroupBy(r => (r.MaterialId, Unit: NormalizeUnit(r.Unit)))
            .SelectMany(g =>
            {
                var real = g.Where(r => !r.IsSeeded).ToList();
                if (real.Count == 0) return g.ToList();
                var latestRunId = real
                    .OrderByDescending(r => r.GeneratedAt).ThenByDescending(r => r.ForecastResultId)
                    .First().ForecastResultId;
                return real.Where(r => r.ForecastResultId == latestRunId).ToList();
            })
            .ToList();

    // A historical BOQ row's purchase quantity/unit, taken from its own real
    // PO lines (HistoricalMaterialSupply) — e.g. a 130 sq.m CHB wall bought
    // as 2,368 pcs. Only when every line is in the same unit (folded the
    // same way as NormalizeUnit, so "pc"/"pcs"/"PCS " count as one) is the
    // sum a meaningful quantity; mixed units, no lines, or no usable unit/
    // quantity at all → null, and the row simply stays in its BOQ unit.
    // The unit is kept as the first line's own spelling (trimmed), never
    // rewritten to the folded form.
    public static (decimal Quantity, string Unit)? ResolveHistoricalPurchase(IEnumerable<(string? Unit, decimal Quantity)> poLines)
    {
        var lines = poLines.ToList();
        if (lines.Count == 0) return null;

        var units = lines.Select(l => NormalizeUnit(l.Unit)).Distinct().ToList();
        if (units.Count != 1 || units[0].Length == 0) return null;

        var total = lines.Sum(l => l.Quantity);
        if (total <= 0) return null;

        return (total, lines[0].Unit!.Trim());
    }

    // Same label folding ForecastService.NormalizeUnitLabel uses — trim + case,
    // plus the pc/pcs/piece/pieces variants — so a forecast row's unit joins
    // the Actual Usage side's unit for the same material. Never a physical
    // unit conversion.
    public static string NormalizeUnit(string? unit)
    {
        var lower = (unit ?? string.Empty).Trim().ToLowerInvariant();
        return lower switch
        {
            "pcs" or "piece" or "pieces" => "pc",
            _ => lower,
        };
    }
}
