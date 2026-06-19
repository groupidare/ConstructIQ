namespace ConstructIQ.API.Algorithms;

/// <summary>
/// ROP = (Average Daily Usage × Lead Time Days) + Safety Stock
/// Safety Stock = Z × StdDev(daily usage) × √(Lead Time Days)
/// Z = 1.65 for 95% service level
/// </summary>
public static class ReorderPointCalculator
{
    private const double Z95 = 1.65;

    public static decimal Calculate(
        decimal avgDailyUsage,
        int     leadTimeDays,
        decimal stdDevDailyUsage = 0)
    {
        var safetyStock = (decimal)(Z95 * (double)stdDevDailyUsage * Math.Sqrt(leadTimeDays));
        return (avgDailyUsage * leadTimeDays) + safetyStock;
    }
}
