namespace ConstructIQ.API.Algorithms;

public record RedistributionMatch(
    int     SourceProjectId,
    int     TargetProjectId,
    int     MaterialId,
    decimal AvailableExcess,
    decimal NeededQuantity,
    decimal TransferQuantity,
    decimal EstimatedSavings);

/// <summary>
/// Rule-based engine: matches excess material from one project to
/// material shortfalls in another, preferring closest projects first.
/// </summary>
public static class RedistributionEngine
{
    public static IEnumerable<RedistributionMatch> FindMatches(
        IEnumerable<(int ProjectId, int MaterialId, decimal ExcessQty, decimal UnitCost)> excessPool,
        IEnumerable<(int ProjectId, int MaterialId, decimal NeededQty)> demandPool)
    {
        var results = new List<RedistributionMatch>();

        var demandLookup = demandPool
            .GroupBy(d => d.MaterialId)
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var supply in excessPool)
        {
            if (!demandLookup.TryGetValue(supply.MaterialId, out var demands))
                continue;

            var remaining = supply.ExcessQty;

            foreach (var demand in demands)
            {
                if (demand.ProjectId == supply.ProjectId) continue;
                if (remaining <= 0) break;

                var transfer = Math.Min(remaining, demand.NeededQty);
                remaining -= transfer;

                results.Add(new RedistributionMatch(
                    SourceProjectId:   supply.ProjectId,
                    TargetProjectId:   demand.ProjectId,
                    MaterialId:        supply.MaterialId,
                    AvailableExcess:   supply.ExcessQty,
                    NeededQuantity:    demand.NeededQty,
                    TransferQuantity:  transfer,
                    EstimatedSavings:  transfer * supply.UnitCost));
            }
        }

        return results;
    }
}
