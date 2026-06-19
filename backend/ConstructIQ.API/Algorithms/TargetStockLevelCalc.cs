namespace ConstructIQ.API.Algorithms;

/// <summary>
/// TSL = ROP + EOQ
/// EOQ = √(2 × AnnualDemand × OrderingCost / HoldingCostPerUnit)
/// </summary>
public static class TargetStockLevelCalc
{
    public static decimal Calculate(
        decimal reorderPoint,
        decimal annualDemand,
        decimal orderingCost,
        decimal holdingCostPerUnit)
    {
        if (holdingCostPerUnit <= 0 || orderingCost <= 0)
            return reorderPoint * 2;

        var eoq = Math.Sqrt((double)(2 * annualDemand * orderingCost / holdingCostPerUnit));
        return reorderPoint + (decimal)eoq;
    }
}
