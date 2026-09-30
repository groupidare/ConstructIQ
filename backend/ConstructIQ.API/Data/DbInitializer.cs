using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Data;

// Backfills realistic historical Excess/Waste records so the Forecasting
// page's Actual-Usage-vs-AI-Predicted chart has a real multi-month line to
// plot instead of an empty state. Run once via `dotnet run --seed-excess`
// (see Program.cs) — safe to re-run since it only ever touches BOQItems that
// have no ExcessWasteRecord yet.
public static class DbInitializer
{
    private static readonly Random Rng = new();

    public static async Task SeedHistoricalExcessAndWasteAsync(AppDbContext context)
    {
        var boqItems = await context.BOQItems
            .Include(b => b.Project)
            .Include(b => b.Material)
            .Where(b => b.EstimatedQuantity > 0)
            .ToListAsync();

        if (boqItems.Count == 0)
        {
            Console.WriteLine("[Seed] No BOQ items found — nothing to seed.");
            return;
        }

        var alreadyLoggedBoqItemIds = (await context.ExcessWasteRecords
                .Where(e => e.BOQItemId != null)
                .Select(e => e.BOQItemId!.Value)
                .Distinct()
                .ToListAsync())
            .ToHashSet();

        var candidates = boqItems.Where(b => !alreadyLoggedBoqItemIds.Contains(b.Id)).ToList();
        if (candidates.Count == 0)
        {
            Console.WriteLine("[Seed] Every BOQ item already has excess/waste history — nothing to seed.");
            return;
        }

        var recordedByUserId = await context.Users
            .Where(u => u.Role == UserRole.Admin)
            .Select(u => u.Id)
            .FirstOrDefaultAsync();
        if (recordedByUserId == 0)
            recordedByUserId = await context.Users.Select(u => u.Id).FirstAsync();

        var now = DateTime.UtcNow;
        var seededCount = 0;
        var zeroExcessCount = 0;

        // Grouped per project so the "a few 100%-efficient items" edge case
        // is spread across projects with BOQ lines to spare, rather than
        // risking an entire small project ending up with zero seeded data.
        foreach (var projectGroup in candidates.GroupBy(b => b.ProjectId))
        {
            var items = projectGroup.OrderBy(_ => Rng.Next()).ToList();
            var project = items[0].Project;
            var zeroExcessBudget = items.Count > 4 ? Rng.Next(0, 3) : 0;

            for (var i = 0; i < items.Count; i++)
            {
                if (i < zeroExcessBudget)
                {
                    zeroExcessCount++;
                    continue; // left at 0 excess / 0 waste: a 100%-efficient item
                }

                await SeedOneBoqItemAsync(context, items[i], project, recordedByUserId, now);
                seededCount++;
            }
        }

        await context.SaveChangesAsync();
        Console.WriteLine(
            $"[Seed] Seeded historical Excess/Waste for {seededCount} BOQ item(s); " +
            $"left {zeroExcessCount} at zero as 100%-efficient edge cases.");
    }

    private static async Task SeedOneBoqItemAsync(
        AppDbContext context, BOQItem boq, Project project, int recordedByUserId, DateTime now)
    {
        // Two independent, non-convertible baselines exist on one BOQ line
        // (EstimatedQuantity vs. the separately-entered EstimatedPurchaseQuantity)
        // — cap by whichever is smaller so a seeded quantity can never trip the
        // same "exceeds baseline" ceiling ExcessWasteService.CreateAsync
        // enforces live.
        var liveBaseline = boq.EstimatedPurchaseQuantity ?? boq.EstimatedQuantity;
        var cappedBaseline = Math.Min(boq.EstimatedQuantity, liveBaseline);
        if (cappedBaseline <= 0) return;

        var excessQty = Math.Round(cappedBaseline * NextDecimal(0.02m, 0.10m), 2);
        var wasteQty = Math.Round(cappedBaseline * NextDecimal(0.01m, 0.05m), 2);

        // Re-checked, not just assumed from the ranges above: rounding on a
        // small quantity can nudge two independent draws right up against the
        // ceiling, and (Excess + Waste) must always stay under the estimate.
        if (excessQty + wasteQty >= cappedBaseline)
        {
            var scale = cappedBaseline * 0.9m / (excessQty + wasteQty);
            excessQty = Math.Round(excessQty * scale, 2);
            wasteQty = Math.Round(wasteQty * scale, 2);
        }

        var unitCost = boq.EstimatedUnitCost > 0 ? boq.EstimatedUnitCost : boq.Material?.UnitCost ?? 0;
        var unit = boq.EstimatedPurchaseUnit ?? boq.Unit ?? boq.Material?.Unit ?? "pcs";

        // "Provisional" vs "Finalized" is derived at read time from
        // Project.Status/IsHistorical (BOQService), never a stored field on
        // the record itself — this date choice is purely for a realistic
        // spread: Active projects skew toward the last 30 days, Completed /
        // historical projects scatter across the full 6-12 month lookback.
        var isActive = project.Status == ProjectStatus.Active && !project.IsHistorical;

        if (excessQty > 0)
        {
            AddRecord(context, boq, recordedByUserId, excessQty, unitCost, isReusable: true,
                excessType: Rng.Next(2) == 0 ? ExcessType.Overordered : ExcessType.Unused,
                recordedAt: isActive ? RandomDateWithinDays(now, 30) : RandomDateMonthsAgo(now, 6, 12));
        }

        if (wasteQty > 0)
        {
            AddRecord(context, boq, recordedByUserId, wasteQty, unitCost, isReusable: false,
                excessType: Rng.Next(2) == 0 ? ExcessType.Damaged : ExcessType.Expired,
                recordedAt: isActive ? RandomDateWithinDays(now, 30) : RandomDateMonthsAgo(now, 6, 12));
        }

        var totalLogged = excessQty + wasteQty;
        boq.ActualQuantity = Math.Max(0, liveBaseline - totalLogged);
        boq.UpdatedAt = now;

        var inventory = await context.InventoryRecords
            .FirstOrDefaultAsync(r => r.ProjectId == boq.ProjectId && r.MaterialId == boq.MaterialId);
        if (inventory is not null)
        {
            inventory.ExcessQuantity += totalLogged;
            inventory.WastedQuantity += wasteQty;
            inventory.AvailableQuantity = Math.Max(0, inventory.AvailableQuantity - wasteQty);
        }

        // `unit` is preserved on Notes for a human skimming the seeded log; the
        // record itself always carries quantity in the same unit as `boq`'s
        // own baseline (Material.Unit/BOQItem.Unit), never re-denominated.
        _ = unit;
    }

    private static void AddRecord(
        AppDbContext context, BOQItem boq, int recordedByUserId,
        decimal quantity, decimal unitCost, bool isReusable, ExcessType excessType, DateTime recordedAt)
    {
        context.ExcessWasteRecords.Add(new ExcessWasteRecord
        {
            ProjectId = boq.ProjectId,
            PhaseId = boq.PhaseId,
            BOQItemId = boq.Id,
            MaterialId = boq.MaterialId,
            ExcessType = excessType,
            Quantity = quantity,
            UnitCost = unitCost,
            TotalCost = quantity * unitCost,
            ExcessPercent = boq.EstimatedQuantity > 0 ? quantity / boq.EstimatedQuantity * 100 : 0,
            IsReusable = isReusable,
            Notes = "Seeded historical data for forecasting model training.",
            RecordedByUserId = recordedByUserId,
            RecordedAt = recordedAt,
        });
    }

    private static decimal NextDecimal(decimal min, decimal max) =>
        min + (decimal)Rng.NextDouble() * (max - min);

    private static DateTime RandomDateMonthsAgo(DateTime now, int minMonths, int maxMonths)
    {
        var start = now.AddMonths(-maxMonths);
        var end = now.AddMonths(-minMonths);
        var rangeMinutes = (end - start).TotalMinutes;
        return start.AddMinutes(Rng.NextDouble() * rangeMinutes);
    }

    private static DateTime RandomDateWithinDays(DateTime now, int days) =>
        now.AddMinutes(-Rng.NextDouble() * days * 24 * 60);

    // Marks a ForecastResult as one this seeder created, so a re-run can tell
    // synthetic rows apart from anything a real Generate Forecast click made.
    private const string ForecastSeedMarker = "Seeded historical forecast aligned to reconciled Excess/Waste data.";

    // Backfills ForecastResult/ForecastedMaterial rows so the Forecasting
    // chart's "AI Predicted" line has more than the single point real forecast
    // runs happen to cover. Aligned to the exact same reporting month and
    // Actual Usage figure BOQService.GetReconciledBoqItemsAsync computes for
    // the real chart (one reporting month per BOQItem — its most recent
    // record's month — carrying the full combined Excess+Waste total), with
    // +/-10% variance layered on top to simulate real model error. Never
    // touches BOQItem/Project/ExcessWasteRecord; safe to re-run (skips if
    // already seeded, identified by the Notes marker, not by clearing again).
    public static async Task SeedHistoricalForecastsAsync(AppDbContext context)
    {
        // Confirmed with the user: every existing ForecastResult (96 rows) was
        // a real Sep 28-29, 2026 test-run cluster — 100% of prior forecast
        // history — which would otherwise clump every AI-Predicted point onto
        // one date. Cleared once, up front, rather than left to accumulate
        // alongside the new historical spread.
        var clusterStart = new DateTime(2026, 9, 28);
        var clusterEnd   = new DateTime(2026, 9, 30);
        var clusterResults = await context.ForecastResults
            .Where(f => f.GeneratedAt >= clusterStart && f.GeneratedAt < clusterEnd)
            .ToListAsync();
        if (clusterResults.Count > 0)
        {
            var clusterIds = clusterResults.Select(f => f.Id).ToList();
            var clusterMaterials = await context.ForecastedMaterials
                .Where(fm => clusterIds.Contains(fm.ForecastResultId))
                .ToListAsync();
            context.ForecastedMaterials.RemoveRange(clusterMaterials);
            context.ForecastResults.RemoveRange(clusterResults);
            await context.SaveChangesAsync();
            Console.WriteLine($"[Seed] Cleared {clusterResults.Count} clumped forecast run(s) from Sep 28-29, 2026.");
        }

        if (await context.ForecastResults.AnyAsync(f => f.Notes == ForecastSeedMarker))
        {
            Console.WriteLine("[Seed] Historical forecasts already seeded — nothing to do.");
            return;
        }

        var records = await context.ExcessWasteRecords
            .Where(e => e.BOQItemId != null)
            .Include(e => e.BOQItem!).ThenInclude(b => b.Material)
            .ToListAsync();

        var created = 0;
        foreach (var group in records.GroupBy(e => e.BOQItemId!.Value))
        {
            var boqItem = group.First().BOQItem!;
            var baseline = boqItem.EstimatedPurchaseQuantity ?? boqItem.EstimatedQuantity;
            var effectiveUnit = !string.IsNullOrWhiteSpace(boqItem.EstimatedPurchaseUnit)
                ? boqItem.EstimatedPurchaseUnit
                : boqItem.Material.Unit;

            // GetMonthlyPredictedTotalsAsync groups AI Predicted totals by the
            // material's own catalog Unit (never a per-BOQItem override), so a
            // prediction only ever lines up with its Actual Usage point when
            // the two share that same unit — seeding a mismatched pair would
            // just create a prediction that can never join anything.
            if (!string.Equals(effectiveUnit, boqItem.Material.Unit, StringComparison.OrdinalIgnoreCase))
                continue;

            var excessTotal = group.Where(e => e.IsReusable).Sum(e => e.Quantity);
            var wasteTotal  = group.Where(e => !e.IsReusable).Sum(e => e.Quantity);
            var deducted = excessTotal + wasteTotal;
            if (baseline <= 0 || deducted > baseline)
                continue; // same validity rule ActualUsageCalculator applies to the real chart

            var actualUsage = baseline - deducted;
            var reportingMonth = group.Max(e => e.RecordedAt);

            var variance = 1 + (decimal)(Rng.NextDouble() * 0.2 - 0.1); // +/-10%
            var predictedQuantity = Math.Max(0, Math.Round(actualUsage * variance, 2));

            var forecastResult = new ForecastResult
            {
                ProjectId   = boqItem.ProjectId,
                PhaseId     = boqItem.PhaseId,
                Period      = ForecastPeriod.Monthly,
                GeneratedAt = new DateTime(reportingMonth.Year, reportingMonth.Month, 15),
                Notes       = ForecastSeedMarker,
            };
            context.ForecastResults.Add(forecastResult);
            context.ForecastedMaterials.Add(new ForecastedMaterial
            {
                ForecastResult     = forecastResult,
                MaterialId         = boqItem.MaterialId,
                ForecastedQuantity = predictedQuantity,
                CurrentStock       = 0,
                Shortage           = 0,
                ReorderSuggestion  = 0,
                RiskLevel          = RiskLevel.Low,
            });
            created++;
        }

        await context.SaveChangesAsync();
        Console.WriteLine($"[Seed] Seeded {created} historical AI-Predicted forecast(s) aligned to reconciled BOQ months.");
    }
}
