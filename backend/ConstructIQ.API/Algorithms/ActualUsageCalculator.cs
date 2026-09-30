namespace ConstructIQ.API.Algorithms;

// Pure, DB-free math for the Forecasting chart's "Actual Usage = Estimated -
// Excess - Waste" figure — kept separate from BOQService's EF Core query so
// the arithmetic and its validation rules can be unit-tested directly,
// without a database. Never clamps an invalid result to zero — a BOQ item
// whose logged Excess+Waste exceeds its Estimated Quantity is a data problem
// to flag and exclude, not something to silently paper over.
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

    // A BOQItem's ExcessWasteRecords are only trustworthy as EstimatedQuantity/
    // Unit-denominated figures when there's no evidence they might actually
    // have been logged in a different, non-convertible purchase unit — i.e.
    // no EstimatedPurchaseQuantity is set, or it happens to share the same
    // unit as EstimatedQuantity anyway. No conversion is ever attempted.
    public static bool IsUnitSafe(decimal? estimatedPurchaseQuantity, string? estimatedPurchaseUnit, string? unit) =>
        estimatedPurchaseQuantity is null
        || string.Equals(estimatedPurchaseUnit?.Trim(), unit?.Trim(), StringComparison.OrdinalIgnoreCase);
}
