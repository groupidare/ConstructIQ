namespace ConstructIQ.API.Algorithms;

/// <summary>
/// Adjusts base lead time based on:
///   - Urgency multiplier (critical orders may use expedited shipping)
///   - Historical delivery performance (ratio of actual vs promised)
///   - Phase proximity (how close the start of the consuming phase is)
/// </summary>
public static class DynamicLeadTimeCalc
{
    public static int Calculate(
        int      baseLeadTimeDays,
        double   deliveryPerformanceRatio = 1.0,
        bool     isUrgent = false,
        int      daysUntilPhaseStart = int.MaxValue)
    {
        var adjusted = baseLeadTimeDays * deliveryPerformanceRatio;

        if (isUrgent)
            adjusted *= 0.7;

        if (daysUntilPhaseStart < adjusted)
            adjusted = daysUntilPhaseStart * 0.85;

        return Math.Max(1, (int)Math.Ceiling(adjusted));
    }
}
