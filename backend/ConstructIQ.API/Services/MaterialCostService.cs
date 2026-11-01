using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Models.Entities;
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
//
// Excess cost impact values excess/waste records with the same prices and
// the same rules (see GetExcessCostImpactAsync).
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

        var priceOf = await LoadPricesAsync(rows.Select(r => r.MaterialId).Distinct().ToList());

        var result = new EstimatedMaterialCostDto { ProjectId = projectId };
        var usedDates = new List<DateTime>();

        foreach (var row in rows)
        {
            if (row.EstimatedPurchaseQuantity is not > 0 || string.IsNullOrWhiteSpace(row.EstimatedPurchaseUnit))
            {
                result.UnpricedItems++;
                continue;
            }

            var price = priceOf(row.MaterialId, row.EstimatedPurchaseUnit);
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

    // Statuses that mean a transfer actually happened — Approved is this
    // app's terminal state (see RedistributionStatuses).
    private static readonly RedistributionStatus[] TransferredStatuses =
        [RedistributionStatus.Approved, RedistributionStatus.InTransit, RedistributionStatus.Completed];

    // ₱ value of logged excess (reusable) and waste (non-reusable): each
    // record's quantity × the latest price for that material in the unit the
    // record is logged in (the same unit the Excess log shows). Valued when
    // read, at current prices — nothing is stored, so records logged before
    // any price existed are valued as soon as one is recorded. A record with
    // no matching price is counted as unpriced, never guessed.
    //
    // Also, on the same price basis:
    //  - Redistributed value: approved transfers out of a project. Approving
    //    one lowers the source record's Quantity, so this is what's no longer
    //    counted as excess there — material reused instead of bought again.
    //  - Purchased value: delivered PO lines, at the line's own price (else
    //    the latest one). In this app actual usage = delivered − excess −
    //    waste, so excess + waste IS the over-purchase; this is what it's
    //    measured against.
    public async Task<ExcessCostImpactDto> GetExcessCostImpactAsync(int? projectId, bool includeMaterialBreakdown)
    {
        var recordQuery = db.ExcessWasteRecords
            .Include(e => e.Material)
            .Include(e => e.BOQItem).ThenInclude(b => b!.HistoricalSupplies)
            .AsQueryable();
        var transferQuery = db.RedistributionRequests
            .Include(r => r.Material)
            .Include(r => r.SourceExcessWasteRecord).ThenInclude(e => e!.BOQItem).ThenInclude(b => b!.HistoricalSupplies)
            .Where(r => TransferredStatuses.Contains(r.Status));
        var deliveryQuery = db.PurchaseOrderMaterials
            .Where(m => m.PurchaseOrder.Status == PurchaseOrderStatus.Delivered);
        if (projectId.HasValue)
        {
            recordQuery   = recordQuery.Where(e => e.ProjectId == projectId.Value);
            transferQuery = transferQuery.Where(r => r.SourceProjectId == projectId.Value);
            deliveryQuery = deliveryQuery.Where(m => m.PurchaseOrder.ProjectId == projectId.Value);
        }

        var records = await recordQuery.AsNoTracking().ToListAsync();
        var transfers = await transferQuery.AsNoTracking().ToListAsync();
        var deliveries = await deliveryQuery
            .Select(m => new { m.PurchaseOrder.ProjectId, m.MaterialId, m.Unit, m.Quantity, m.UnitPrice })
            .ToListAsync();

        var priceOf = await LoadPricesAsync(records.Select(r => r.MaterialId)
            .Concat(transfers.Select(t => t.MaterialId))
            .Concat(deliveries.Where(d => d.MaterialId.HasValue).Select(d => d.MaterialId!.Value))
            .Distinct().ToList());

        DatedPrice? PriceIn(int materialId, string unit) =>
            string.IsNullOrWhiteSpace(unit) ? null : priceOf(materialId, unit);

        var valued = records.Select(r =>
        {
            var unit = ExcessWasteService.PreferredUnit(r.BOQItem, r.Material?.Unit);
            var price = PriceIn(r.MaterialId, unit);
            return new
            {
                Record = r,
                Unit = unit,
                Price = price,
                Value = price is null ? 0m : r.Quantity * price.Price,
            };
        }).ToList();

        var valuedTransfers = transfers.Select(t =>
        {
            // Same unit the source excess record (and the transfer) is in.
            var price = PriceIn(t.MaterialId, ExcessWasteService.PreferredUnit(t.SourceExcessWasteRecord?.BOQItem, t.Material?.Unit));
            return new
            {
                t.SourceProjectId,
                Month = (t.ApprovedAt ?? t.RequestedAt).ToString("yyyy-MM"),
                Price = price,
                Value = price is null ? 0m : t.Quantity * price.Price,
            };
        }).ToList();

        var valuedDeliveries = deliveries.Select(d =>
        {
            decimal? price = d.UnitPrice ?? (d.MaterialId.HasValue ? PriceIn(d.MaterialId.Value, d.Unit)?.Price : null);
            return new { d.ProjectId, Priced = price.HasValue, Value = price.HasValue ? d.Quantity * price.Value : 0m };
        }).ToList();

        var priced = valued.Where(v => v.Price is not null).ToList();
        var dates = priced.Where(v => v.Price!.Date.HasValue).Select(v => v.Price!.Date!.Value).ToList();

        var projectIds = valued.Select(v => v.Record.ProjectId)
            .Concat(valuedTransfers.Select(t => t.SourceProjectId))
            .Concat(valuedDeliveries.Select(d => d.ProjectId))
            .Distinct().ToList();
        var projectNames = await db.Projects
            .Where(p => projectIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.Name);

        var result = new ExcessCostImpactDto
        {
            ExcessValue        = Round(priced.Where(v => v.Record.IsReusable).Sum(v => v.Value)),
            WasteCost          = Round(priced.Where(v => !v.Record.IsReusable).Sum(v => v.Value)),
            RedistributedValue = Round(valuedTransfers.Sum(t => t.Value)),
            PurchasedValue     = Round(valuedDeliveries.Sum(d => d.Value)),
            PricedRecords      = priced.Count,
            UnpricedRecords    = valued.Count - priced.Count,
            UnpricedTransfers  = valuedTransfers.Count(t => t.Price is null),
            UnpricedDeliveries = valuedDeliveries.Count(d => !d.Priced),
            OldestPriceDate    = dates.Count > 0 ? dates.Min() : null,
            NewestPriceDate    = dates.Count > 0 ? dates.Max() : null,
            ByProject = projectIds
                .Select(id => new ExcessCostByProjectDto
                {
                    ProjectId          = id,
                    ProjectName        = projectNames.GetValueOrDefault(id, string.Empty),
                    ExcessValue        = Round(valued.Where(v => v.Record.ProjectId == id && v.Record.IsReusable).Sum(v => v.Value)),
                    WasteCost          = Round(valued.Where(v => v.Record.ProjectId == id && !v.Record.IsReusable).Sum(v => v.Value)),
                    RedistributedValue = Round(valuedTransfers.Where(t => t.SourceProjectId == id).Sum(t => t.Value)),
                    PurchasedValue     = Round(valuedDeliveries.Where(d => d.ProjectId == id).Sum(d => d.Value)),
                    UnpricedRecords    = valued.Count(v => v.Record.ProjectId == id && v.Price is null),
                })
                .OrderByDescending(p => p.ExcessValue + p.WasteCost)
                .ThenByDescending(p => p.PurchasedValue)
                .ToList(),
            // By month logged (excess/waste) or approved (transfers).
            MonthlyTrend = priced.Select(v => (Month: v.Record.RecordedAt.ToString("yyyy-MM"), Excess: v.Record.IsReusable ? v.Value : 0m, Waste: v.Record.IsReusable ? 0m : v.Value, Redistributed: 0m))
                .Concat(valuedTransfers.Where(t => t.Price is not null).Select(t => (t.Month, Excess: 0m, Waste: 0m, Redistributed: t.Value)))
                .GroupBy(x => x.Month)
                .Select(g => new ExcessCostTrendDto
                {
                    Month              = g.Key,
                    ExcessValue        = Round(g.Sum(x => x.Excess)),
                    WasteCost          = Round(g.Sum(x => x.Waste)),
                    RedistributedValue = Round(g.Sum(x => x.Redistributed)),
                })
                .OrderBy(t => t.Month)
                .ToList(),
        };
        result.TotalCost = result.ExcessValue + result.WasteCost;

        // Per-material rows reveal the unit price (value ÷ quantity), so
        // they're only filled in for roles that may see prices.
        if (includeMaterialBreakdown)
        {
            result.ByMaterial = priced
                .GroupBy(v => (v.Record.MaterialId, CompletedProjectDemandRules.NormalizeUnit(v.Unit)))
                .Select(g => new ExcessCostByMaterialDto
                {
                    MaterialId     = g.Key.MaterialId,
                    MaterialName   = g.First().Record.Material?.Name ?? string.Empty,
                    Unit           = g.First().Unit,
                    UnitPrice      = g.First().Price!.Price,
                    ExcessQuantity = g.Where(v => v.Record.IsReusable).Sum(v => v.Record.Quantity),
                    WasteQuantity  = g.Where(v => !v.Record.IsReusable).Sum(v => v.Record.Quantity),
                    ExcessValue    = Round(g.Where(v => v.Record.IsReusable).Sum(v => v.Value)),
                    WasteCost      = Round(g.Where(v => !v.Record.IsReusable).Sum(v => v.Value)),
                })
                .OrderByDescending(m => m.ExcessValue + m.WasteCost)
                .ToList();
        }

        return result;
    }

    private static decimal Round(decimal x) => Math.Round(x, 2, MidpointRounding.AwayFromZero);

    // Latest price for each (material, unit) among the given materials, from
    // the three sources in order — PO, then historical supply, then catalog.
    // The returned lookup normalizes the unit itself.
    private async Task<Func<int, string?, DatedPrice?>> LoadPricesAsync(List<int> materialIds)
    {
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

        return (materialId, unit) =>
        {
            var key = (materialId, CompletedProjectDemandRules.NormalizeUnit(unit));
            return poPrices.GetValueOrDefault(key)
                ?? historicalPrices.GetValueOrDefault(key)
                ?? catalogPrices.GetValueOrDefault(key);
        };
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
