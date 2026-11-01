namespace ConstructIQ.API.Algorithms;

// Pure, DB-free math for the Forecasting chart's "Actual Usage = Estimated -
// Excess - Waste" figure — kept separate from BOQService's EF Core query so
// the arithmetic and its validation rules can be unit-tested directly,
// without a database. Never clamps an invalid result to zero — a BOQ item
// whose logged Excess+Waste exceeds its Estimated Quantity is a data problem
// to flag and exclude, not something to silently paper over.
//
// "Estimated Quantity" here is always whichever baseline the Excess/Waste
// records were actually logged against (BOQService resolves that to
// EstimatedPurchaseQuantity ?? EstimatedQuantity, exactly like the Record
// Excess/Waste picker and BOQItem.ActualQuantity already do) — never a fixed
// field name, since two independent, non-convertible baselines exist on one
// BOQ line and only one of them is ever the one a given record used.
public static class ActualUsageCalculator
{
    public readonly record struct Result(decimal? ActualUsage, bool IsValid, string? ErrorMessage)
    {
        public static Result Ok(decimal actualUsage) => new(actualUsage, true, null);
        public static Result Invalid(string message) => new(null, false, message);
    }

    public static Result Calculate(decimal estimatedQuantity, decimal excessTotal, decimal wasteTotal)
    {
        if (estimatedQuantity < 0 || excessTotal < 0 || wasteTotal < 0)
            return Result.Invalid("Estimated quantity, excess, and waste must all be zero or positive.");

        var deducted = excessTotal + wasteTotal;
        if (deducted > estimatedQuantity)
            return Result.Invalid(
                $"Excess ({excessTotal}) + Waste ({wasteTotal}) = {deducted} exceeds the Estimated Quantity ({estimatedQuantity}).");

        // Explicit zero excess and zero waste is a valid, meaningful result
        // (Actual Usage == Estimated Quantity), same code path as any other
        // in-range combination — not a special case.
        return Result.Ok(estimatedQuantity - deducted);
    }
}
