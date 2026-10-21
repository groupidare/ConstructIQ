using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Estimated Material Cost = Σ (forecasted purchase quantity × latest recorded
// unit price) over a project's BOQ items. A price only counts when it's for
// the same material in the same (normalized) purchase unit — never converted,
// averaged or guessed. Sources, first match wins:
//   1. latest PurchaseOrderMaterial.UnitPrice (any project, by PO OrderDate)
//   2. latest HistoricalMaterialSupply.UnitCost (by the historical project's TargetEndDate)
//   3. Material.UnitCost from the catalog, if > 0
// Rows with no quantity, no unit or no matching price are counted as unpriced
// and left out of the total. The BOQ area quantity (sq.m) is never priced.
public class MaterialCostService(AppDbContext db) : IMaterialCostService
{
    private record DatedPrice(decimal Price, DateTime? Date);

    public async Task<EstimatedMaterialCostDto?> GetEstimatedMaterialCostAsync(int projectId)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == projectId))
            return null;

        var rows = await db.BOQItems
            .Where(b => b.ProjectId == projectId)
            .Select(b => new { b.MaterialId, b.EstimatedPurchaseQuantity, b.EstimatedPurchaseUnit })
            .ToListAsync();

        var materialIds = rows.Select(r => r.MaterialId).Distinct().ToList();

        var poPrices = LatestByKey((await db.PurchaseOrderMaterials
            .Where(m => m.UnitPrice != null && m.MaterialId != null && materialIds.Contains(m.MaterialId.Value))
            .Select(m => new { MaterialId = m.MaterialId!.Value, m.Unit, Price = m.UnitPrice!.Value, Date = m.PurchaseOrder.OrderDate, m.Id })
            .ToListAsync())
            .Select(m => (m.MaterialId, m.Unit, m.Price, m.Date, m.Id)));

        var historicalPrices = LatestByKey((await db.HistoricalMaterialSupplies
            .Where(h => h.UnitCost != null && materialIds.Contains(h.BOQItem.MaterialId))
            .Select(h => new { h.BOQItem.MaterialId, h.Unit, Price = h.UnitCost!.Value, Date = h.BOQItem.Project.TargetEndDate, h.Id })
            .ToListAsync())
            .Select(h => (h.MaterialId, h.Unit, h.Price, h.Date, h.Id)));

        var catalogPrices = (await db.Materials
            .Where(m => materialIds.Contains(m.Id) && m.UnitCost > 0)
            .Select(m => new { m.Id, m.Unit, m.UnitCost })
            .ToListAsync())
            .ToDictionary(m => (m.Id, CompletedProjectDemandRules.NormalizeUnit(m.Unit)), m => new DatedPrice(m.UnitCost, null));

        var result = new EstimatedMaterialCostDto { ProjectId = projectId };
        var usedDates = new List<DateTime>();

        foreach (var row in rows)
        {
            if (row.EstimatedPurchaseQuantity is not > 0 || string.IsNullOrWhiteSpace(row.EstimatedPurchaseUnit))
            {
                result.UnpricedItems++;
                continue;
            }

            var key = (row.MaterialId, CompletedProjectDemandRules.NormalizeUnit(row.EstimatedPurchaseUnit));
            var price = poPrices.GetValueOrDefault(key)
                ?? historicalPrices.GetValueOrDefault(key)
                ?? catalogPrices.GetValueOrDefault(key);

            if (price is null)
            {
                result.UnpricedItems++;
                continue;
            }

            result.PricedItems++;
            result.TotalEstimatedCost += row.EstimatedPurchaseQuantity.Value * price.Price;
            if (price.Date is DateTime date) usedDates.Add(date);
        }

        result.TotalEstimatedCost = Math.Round(result.TotalEstimatedCost, 2, MidpointRounding.AwayFromZero);
        if (usedDates.Count > 0)
        {
            result.OldestPriceDate = usedDates.Min();
            result.NewestPriceDate = usedDates.Max();
        }
        return result;
    }

    // Latest price per (material, normalized unit). Id breaks date ties so the
    // most recently entered record wins.
    private static Dictionary<(int, string), DatedPrice> LatestByKey(
        IEnumerable<(int MaterialId, string Unit, decimal Price, DateTime Date, int Id)> prices) =>
        prices
            .GroupBy(p => (p.MaterialId, CompletedProjectDemandRules.NormalizeUnit(p.Unit)))
            .ToDictionary(
                g => g.Key,
                g =>
                {
                    var latest = g.OrderByDescending(p => p.Date).ThenByDescending(p => p.Id).First();
                    return new DatedPrice(latest.Price, latest.Date);
                });
}
