using System.Text.RegularExpressions;
using ConstructIQ.API.Models.DTOs.Blueprint;

namespace ConstructIQ.API.Algorithms;

// Merges a provided (scanned) BOQ into a blueprint-generated one. The
// provided BOQ only fills gaps — it never overwrites a generated row:
//   not in the generated rows                        → add
//   same material + work item, within ±5%            → skip (confirmed)
//   same material + work item, off by more / other unit → flag (generated kept unless the user switches)
//   no quantity or an unknown unit                   → incomplete (the user completes or skips it; never added silently)
public static class BoqMerge
{
    public const double Tolerance = 0.05;

    private static string WorkItem(string? subCategory, string? primarySection)
    {
        var s = string.IsNullOrWhiteSpace(subCategory) ? primarySection : subCategory;
        // "1.1  Floor Finish" and "floor finish" are the same work item.
        return Regex.Replace((s ?? string.Empty).Trim(), @"^\d+(\.\d+)*[\.\)]?\s*", string.Empty).ToLowerInvariant();
    }

    private static bool KnownUnit(string? unit) =>
        !string.IsNullOrWhiteSpace(unit)
        && (BaselineCalculator.WorkUnitKind(unit) is not null
            || BaselineCalculator.PurchaseUnitKey(unit) is "pc" or "sheet" or "gal" or "bag" or "box" or "set" or "roll" or "pail" or "can"
            || unit.Trim().ToLowerInvariant() is "lot" or "kg" or "pack");

    public static List<MergeResultRowDto> Preview(IReadOnlyList<MergeRowInputDto> generated, IEnumerable<MergeScannedRowDto> scanned)
    {
        var results = new List<MergeResultRowDto>();
        foreach (var row in scanned)
        {
            if (row.EstimatedQuantity <= 0 || !KnownUnit(row.Unit))
            {
                results.Add(new MergeResultRowDto
                {
                    Action = MergeActions.Incomplete, Scanned = row,
                    Reason = row.EstimatedQuantity <= 0 ? "No quantity" : $"Unknown unit \"{row.Unit}\"",
                });
                continue;
            }

            var scannedItem = WorkItem(row.SubCategory, row.PrimarySection);
            var match = row.MatchedMaterialId is { } materialId
                ? generated.Select((g, i) => (g, i)).FirstOrDefault(x => x.g.MaterialId == materialId
                    && (string.IsNullOrEmpty(scannedItem) || WorkItem(x.g.SubCategory, x.g.PrimarySection) == scannedItem))
                : default;

            if (match.g is null)
            {
                results.Add(new MergeResultRowDto { Action = MergeActions.Add, Scanned = row, Reason = "Not in the generated BOQ" });
                continue;
            }

            var generatedQty = match.g.BoqQuantity;
            if (BaselineCalculator.PurchaseUnitKey(match.g.BoqUnit) != BaselineCalculator.PurchaseUnitKey(row.Unit))
            {
                results.Add(new MergeResultRowDto
                {
                    Action = MergeActions.Flag, Scanned = row, GeneratedIndex = match.i, GeneratedQuantity = generatedQty,
                    Reason = $"Provided in {row.Unit}, generated in {match.g.BoqUnit}",
                });
                continue;
            }

            var difference = generatedQty > 0 ? Math.Abs((double)row.EstimatedQuantity - generatedQty) / generatedQty : 1.0;
            results.Add(new MergeResultRowDto
            {
                Action = difference <= Tolerance ? MergeActions.Skip : MergeActions.Flag,
                Scanned = row, GeneratedIndex = match.i, GeneratedQuantity = generatedQty,
                DifferencePct = Math.Round(difference * 100, 1),
                Reason = difference <= Tolerance ? "Confirms the generated quantity" : "Differs from the generated quantity by more than 5%",
            });
        }
        return results;
    }
}
