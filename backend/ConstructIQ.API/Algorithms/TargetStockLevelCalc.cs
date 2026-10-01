namespace ConstructIQ.API.Algorithms;

/// <summary>
/// TSL = ROP + one more lead-time cycle of usage — enough stock on hand to
/// survive a second full lead time after the reorder point is hit, so a
/// slightly delayed delivery doesn't immediately cause a shortage.
///
/// Deliberately not the classic EOQ formula (TSL = ROP + √(2 × AnnualDemand ×
/// OrderingCost / HoldingCostPerUnit)) — that needs a real "cost per order
/// placed" figure the system has no source for (not the same thing as a
/// material's unit price), so it was previously a hardcoded guess rather
/// than a calculated value. This version only uses quantities the system
/// already has real numbers for.
/// </summary>
public static class TargetStockLevelCalc
{
    public static decimal Calculate(
        decimal reorderPoint,
        decimal avgDailyUsage,
        int     leadTimeDays)
    {
        return reorderPoint + (avgDailyUsage * leadTimeDays);
    }
}
