using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Estimated Material Cost of a project = Committed + Remaining, per BOQ line:
//   Committed = what's already on this project's POs (historical purchases
//               for a completed project added as history), each line at its
//               own price, else the latest recorded one.
//   Remaining = (forecasted purchase qty − ordered qty, never below zero)
//               × the latest recorded unit price.
// A new project has nothing ordered, so it's all Remaining; a finished one
// is all Committed. A price only counts when it's for the same material in
// the same (normalized) unit — never converted, averaged or guessed.
// Price sources, first match wins:
//   1. purchase orders — this system's POs (PurchaseOrderMaterial, dated by
//      OrderDate) and historical projects' POs (HistoricalMaterialSupply,
//      dated by its PO DATE, else the project's TargetEndDate) as one pool: the latest date,
//      and when several POs share that date (different suppliers), the
//      lowest price
//   2. latest supplier quotation typed on the Material Request Form (the
//      most recently updated request's chosen quote, else its lowest; a
//      price auto-filled from a past PO isn't a quotation and is skipped)
//   3. a SIMILAR material's PO price in the same unit (MaterialNameMatch:
//      the same product written differently, sizes agreeing; failing that,
//      the same main noun and another shared keyword) — the latest
//      date, the lowest on that date — shown as from that material
//   4. Material.UnitCost from the catalog, if > 0
// A line nothing prices stays in the breakdown with the reason, at no cost.
// Lines with no forecast quantity are listed too but left out of the
// totals. The BOQ area quantity (sq.m) is never priced.
//
// Excess cost impact values excess/waste records with the same prices and
// the same rules (see GetExcessCostImpactAsync).
public class MaterialCostService(AppDbContext db) : IMaterialCostService
{
    private record DatedPrice(decimal Price, DateTime? Date, string Source = "", string? Reference = null);

    private const string SourcePo = "Purchase order";
    private const string SourceQuotation = "Supplier quotation";
    private const string SourceHistorical = "Past project";
    private const string SourceCatalog = "Material catalog";
    private const string SourceSimilar = "Similar material";

    // One already-ordered line of this project, in its own unit.
    private record OrderedLine(int? BOQItemId, int? MaterialId, string Name, string Unit, decimal Quantity,
        decimal? OwnPrice, DateTime Date);

    private sealed class Line
    {
        public required MaterialCostLineDto Dto { get; init; }
        public int? MaterialId { get; init; }
        public string UnitKey { get; init; } = string.Empty;
        public bool CommittedFullyPriced { get; set; } = true;
    }

    public async Task<EstimatedMaterialCostDto?> GetEstimatedMaterialCostAsync(int projectId)
    {
        var project = await db.Projects
            .Where(p => p.Id == projectId)
            .Select(p => new { p.Id, p.TargetEndDate })
            .FirstOrDefaultAsync();
        if (project is null)
            return null;

        var rows = await db.BOQItems
            .Where(b => b.ProjectId == projectId)
            .OrderBy(b => b.Id)
            .Select(b => new
            {
                b.Id, b.MaterialId, MaterialName = b.Material.Name, b.Specification, b.PrimarySection,
                b.EstimatedPurchaseQuantity, b.EstimatedPurchaseUnit, CatalogUnit = b.Material.Unit,
            })
            .ToListAsync();

        var ordered = (await db.PurchaseOrderMaterials
                .Where(m => m.PurchaseOrder.ProjectId == projectId && m.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
                .Select(m => new OrderedLine(m.BOQItemId, m.MaterialId, m.Name, m.Unit, m.Quantity, m.UnitPrice, m.PurchaseOrder.OrderDate))
                .ToListAsync())
            .Concat(await db.HistoricalMaterialSupplies
                .Where(h => h.BOQItem.ProjectId == projectId)
                .Select(h => new OrderedLine(h.BOQItemId, h.BOQItem.MaterialId, h.MaterialName, h.Unit, h.Quantity, h.UnitCost, h.PoDate ?? project.TargetEndDate))
                .ToListAsync())
            .ToList();

        var priceOf = await LoadPricesAsync(rows.Select(r => r.MaterialId)
            .Concat(ordered.Where(o => o.MaterialId.HasValue).Select(o => o.MaterialId!.Value))
            .Distinct().ToList());

        var lines = rows.Select(r =>
        {
            var hasForecast = r.EstimatedPurchaseQuantity is > 0 && !string.IsNullOrWhiteSpace(r.EstimatedPurchaseUnit);
            var unit = !string.IsNullOrWhiteSpace(r.EstimatedPurchaseUnit) ? r.EstimatedPurchaseUnit : r.CatalogUnit;
            return new Line
            {
                MaterialId = r.MaterialId,
                UnitKey = CompletedProjectDemandRules.NormalizeUnit(unit),
                Dto = new MaterialCostLineDto
                {
                    BOQItemId = r.Id,
                    MaterialName = r.MaterialName,
                    Specification = r.Specification,
                    Section = r.PrimarySection,
                    Unit = unit ?? string.Empty,
                    ForecastQuantity = hasForecast ? r.EstimatedPurchaseQuantity : null,
                },
            };
        }).ToList();
        var byBoqId = lines.ToDictionary(l => l.Dto.BOQItemId!.Value);
        var usedDates = new List<DateTime>();

        // Ordered lines attach to the Material Plan row they belong to, in
        // that row's unit: an explicit BOQ link first, else the same material
        // and unit (PO lines made from Material Requests carry no BOQ link),
        // filling the first row that still has quantity left. Anything else
        // gets a line of its own so its cost is still counted.
        Line? Attach(OrderedLine o)
        {
            var key = CompletedProjectDemandRules.NormalizeUnit(o.Unit);
            if (o.BOQItemId is int boqId && byBoqId.TryGetValue(boqId, out var linked))
                return linked.Dto.ForecastQuantity.HasValue && linked.UnitKey == key ? linked : null;
            if (o.MaterialId is null) return null;
            var candidates = lines
                .Where(l => l.Dto.BOQItemId.HasValue && l.Dto.ForecastQuantity.HasValue && l.MaterialId == o.MaterialId && l.UnitKey == key)
                .ToList();
            return candidates.FirstOrDefault(l => l.Dto.OrderedQuantity < l.Dto.ForecastQuantity) ?? candidates.FirstOrDefault();
        }

        var extras = new Dictionary<(string, string), Line>();
        foreach (var o in ordered.OrderBy(o => o.BOQItemId.HasValue ? 0 : 1).ThenBy(o => o.Date))
        {
            var line = Attach(o);
            if (line is null)
            {
                var key = CompletedProjectDemandRules.NormalizeUnit(o.Unit);
                var name = o.MaterialId?.ToString() ?? o.Name.Trim().ToLowerInvariant();
                if (!extras.TryGetValue((name, key), out line))
                {
                    var planRow = o.BOQItemId is int id && byBoqId.TryGetValue(id, out var r) ? r : null;
                    line = new Line
                    {
                        MaterialId = o.MaterialId,
                        UnitKey = key,
                        Dto = new MaterialCostLineDto
                        {
                            MaterialName = planRow?.Dto.MaterialName ?? o.Name,
                            Specification = planRow?.Dto.Specification,
                            Section = planRow?.Dto.Section,
                            Unit = o.Unit,
                            Note = planRow is null ? "Ordered, not in the Material Plan"
                                : planRow.Dto.ForecastQuantity is null ? "Ordered; its Material Plan row has no forecast yet"
                                : "Ordered in a different unit than the Material Plan",
                        },
                    };
                    extras[(name, key)] = line;
                }
            }

            line.Dto.OrderedQuantity += o.Quantity;
            var price = o.OwnPrice ?? (o.MaterialId is int mid ? priceOf(mid, o.Unit)?.Price : null);
            if (price is null)
            {
                line.CommittedFullyPriced = false;
                continue;
            }
            line.Dto.CommittedCost += o.Quantity * price.Value;
            usedDates.Add(o.Date);
        }

        // Price checks still waiting in Procurement's Quotations tab.
        var openInquiries = (await db.MaterialRequests
                .Where(r => r.ProjectId == projectId && r.IsPriceInquiry && r.FulfilledByPurchaseOrderId == null
                            && !r.Quotes.Any(q => q.UnitPrice != null))
                .Select(r => new { r.MaterialId, r.Unit })
                .ToListAsync())
            .Select(r => (r.MaterialId, CompletedProjectDemandRules.NormalizeUnit(r.Unit)))
            .ToHashSet();

        var result = new EstimatedMaterialCostDto { ProjectId = projectId };
        foreach (var line in lines.Concat(extras.Values))
        {
            var dto = line.Dto;
            dto.MaterialId = line.MaterialId;
            if (line.MaterialId is int materialId && priceOf(materialId, dto.Unit) is DatedPrice latest)
            {
                dto.UnitPrice = latest.Price;
                dto.PriceSource = latest.Source;
                dto.PriceReference = latest.Reference;
                dto.PriceDate = latest.Date;
            }

            dto.RemainingQuantity = dto.ForecastQuantity is decimal forecast ? Math.Max(0, forecast - dto.OrderedQuantity) : 0;
            if (dto.RemainingQuantity > 0)
            {
                if (dto.UnitPrice is decimal unitPrice)
                {
                    dto.RemainingCost = dto.RemainingQuantity * unitPrice;
                    if (dto.PriceDate is DateTime date) usedDates.Add(date);
                }
                else dto.NeedsPrice = true;
            }
            if (!line.CommittedFullyPriced) dto.NeedsPrice = true;
            dto.QuotationRequested = dto.NeedsPrice && line.MaterialId is int mat && openInquiries.Contains((mat, line.UnitKey));

            var noForecast = dto.BOQItemId.HasValue && dto.ForecastQuantity is null && dto.OrderedQuantity == 0;
            dto.NoForecast = noForecast;
            if (noForecast && dto.UnitPrice is null && !string.IsNullOrWhiteSpace(dto.Unit))
            {
                dto.NeedsPrice = true;
                dto.QuotationRequested = line.MaterialId is int m && openInquiries.Contains((m, line.UnitKey));
            }
            if (noForecast)
                dto.Note = dto.UnitPrice is null
                    ? "No forecasted purchase quantity yet"
                    : "Price ready — not in the total until it has a forecasted purchase quantity";
            else if (dto.NeedsPrice && dto.Note is null)
                dto.Note = "No price — no PO for this material or a similar one in this unit";

            dto.CommittedCost = Round(dto.CommittedCost);
            dto.RemainingCost = Round(dto.RemainingCost);
            result.CommittedCost += dto.CommittedCost;
            result.RemainingCost += dto.RemainingCost;

            if (noForecast) result.NoForecastItems++;
            if (dto.NeedsPrice) result.UnpricedItems++;
            else if (!noForecast) result.PricedItems++;
            result.Lines.Add(dto);
        }

        result.TotalEstimatedCost = result.CommittedCost + result.RemainingCost;
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
    //  - Redistributed value: approved transfers out of a project and warehouse
    //    releases of its excess to another. Either lowers the source record's
    //    Quantity, so this is what's no longer counted as excess there —
    //    material reused instead of bought again.
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
        var releaseQuery = db.WarehouseReleaseSources
            .Include(s => s.WarehouseRequest)
            .Include(s => s.ExcessWasteRecord).ThenInclude(e => e.Material)
            .Include(s => s.ExcessWasteRecord).ThenInclude(e => e.BOQItem).ThenInclude(b => b!.HistoricalSupplies)
            .Where(s => s.WarehouseRequest.ProjectId != s.ExcessWasteRecord.ProjectId);
        var deliveryQuery = db.PurchaseOrderMaterials
            .Where(m => m.PurchaseOrder.Status == PurchaseOrderStatus.Delivered);
        if (projectId.HasValue)
        {
            releaseQuery  = releaseQuery.Where(s => s.ExcessWasteRecord.ProjectId == projectId.Value);
            recordQuery   = recordQuery.Where(e => e.ProjectId == projectId.Value);
            transferQuery = transferQuery.Where(r => r.SourceProjectId == projectId.Value);
            deliveryQuery = deliveryQuery.Where(m => m.PurchaseOrder.ProjectId == projectId.Value);
        }

        var records = await recordQuery.AsNoTracking().ToListAsync();
        var transfers = await transferQuery.AsNoTracking().ToListAsync();
        var releases = await releaseQuery.AsNoTracking().ToListAsync();
        var deliveries = await deliveryQuery
            .Select(m => new { m.PurchaseOrder.ProjectId, m.MaterialId, m.Unit, m.Quantity, m.UnitPrice })
            .ToListAsync();

        var priceOf = await LoadPricesAsync(records.Select(r => r.MaterialId)
            .Concat(transfers.Select(t => t.MaterialId))
            .Concat(releases.Select(s => s.ExcessWasteRecord.MaterialId))
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
        }).Concat(releases.Select(s =>
        {
            var record = s.ExcessWasteRecord;
            var price = PriceIn(record.MaterialId, ExcessWasteService.PreferredUnit(record.BOQItem, record.Material?.Unit));
            return new
            {
                SourceProjectId = record.ProjectId,
                Month = (s.WarehouseRequest.ApprovedAt ?? s.WarehouseRequest.RequestedAt).ToString("yyyy-MM"),
                Price = price,
                Value = price is null ? 0m : s.Quantity * price.Price,
            };
        })).ToList();

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

    // Price for each (material, unit) among the given materials, from the
    // three sources in order — POs (this system's and historical projects'),
    // quotation, catalog. The returned lookup normalizes the unit itself.
    private async Task<Func<int, string?, DatedPrice?>> LoadPricesAsync(List<int> materialIds)
    {
        var systemPoPrices = (await db.PurchaseOrderMaterials
            .Where(m => m.UnitPrice != null && m.MaterialId != null && materialIds.Contains(m.MaterialId.Value)
                && m.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
            .Select(m => new { MaterialId = m.MaterialId!.Value, m.Unit, Price = m.UnitPrice!.Value, Date = m.PurchaseOrder.OrderDate, m.Id, m.PurchaseOrder.Number, Supplier = m.PurchaseOrder.Supplier.Name })
            .ToListAsync())
            .Select(m => new PoPrice(m.MaterialId, m.Unit, m.Price, m.Date, m.Id, SourcePo, $"{m.Number} · {m.Supplier}"));

        var historicalPoPrices = (await db.HistoricalMaterialSupplies
            .Where(h => h.UnitCost != null && materialIds.Contains(h.BOQItem.MaterialId))
            .Select(h => new { h.BOQItem.MaterialId, h.Unit, Price = h.UnitCost!.Value, Date = h.PoDate ?? h.BOQItem.Project.TargetEndDate, h.Id, Project = h.BOQItem.Project.Name, h.PoNumber })
            .ToListAsync())
            .Select(h => new PoPrice(h.MaterialId, h.Unit, h.Price, h.Date, h.Id, SourceHistorical,
                string.IsNullOrWhiteSpace(h.PoNumber) ? h.Project : $"{h.PoNumber} · {h.Project}"));

        var poPrices = LatestLowestByKey(systemPoPrices.Concat(historicalPoPrices));

        // Per (material, unit): the most recently updated request's quotes,
        // its chosen one if any, else its lowest price.
        var quotePrices = (await db.MaterialRequestQuotes
                .Where(q => q.UnitPrice != null && !q.PriceFromHistory && materialIds.Contains(q.MaterialRequest.MaterialId))
                .Select(q => new { q.MaterialRequest.MaterialId, q.MaterialRequest.Unit, q.MaterialRequestId, Price = q.UnitPrice!.Value, q.IsSelected, q.SupplierName, q.UpdatedAt })
                .ToListAsync())
            .GroupBy(q => (q.MaterialId, CompletedProjectDemandRules.NormalizeUnit(q.Unit)))
            .ToDictionary(
                g => g.Key,
                g =>
                {
                    var latestRequest = g.GroupBy(q => q.MaterialRequestId)
                        .OrderByDescending(r => r.Max(q => q.UpdatedAt)).ThenByDescending(r => r.Key)
                        .First();
                    var pick = latestRequest.FirstOrDefault(q => q.IsSelected) ?? latestRequest.OrderBy(q => q.Price).First();
                    return new DatedPrice(pick.Price, latestRequest.Max(q => q.UpdatedAt), SourceQuotation, pick.SupplierName);
                });

        var catalogPrices = (await db.Materials
            .Where(m => materialIds.Contains(m.Id) && m.UnitCost > 0)
            .Select(m => new { m.Id, m.Unit, m.UnitCost })
            .ToListAsync())
            .ToDictionary(m => (m.Id, CompletedProjectDemandRules.NormalizeUnit(m.Unit)), m => new DatedPrice(m.UnitCost, null, SourceCatalog));

        var similarPrices = await LoadSimilarPricesAsync(
            materialIds.Where(id => !poPrices.Keys.Any(k => k.Item1 == id)).ToList());

        return (materialId, unit) =>
        {
            var key = (materialId, CompletedProjectDemandRules.NormalizeUnit(unit));
            return poPrices.GetValueOrDefault(key)
                ?? quotePrices.GetValueOrDefault(key)
                ?? similarPrices.GetValueOrDefault(key)
                ?? catalogPrices.GetValueOrDefault(key);
        };
    }

    // For materials with no PO price of their own: the PO price of a similar
    // material (see MaterialNameMatch.IsSimilar) in each unit — the latest
    // date, the lowest on that date — referenced by that material's name.
    // Compared only against materials that have a PO price at all.
    private async Task<Dictionary<(int, string), DatedPrice>> LoadSimilarPricesAsync(List<int> unpricedIds)
    {
        if (unpricedIds.Count == 0) return [];

        var pricedIds = (await db.PurchaseOrderMaterials
                .Where(m => m.UnitPrice != null && m.MaterialId != null && m.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
                .Select(m => m.MaterialId!.Value).Distinct().ToListAsync())
            .Concat(await db.HistoricalMaterialSupplies
                .Where(h => h.UnitCost != null)
                .Select(h => h.BOQItem.MaterialId).Distinct().ToListAsync())
            .ToHashSet();
        var names = await db.Materials
            .Where(m => unpricedIds.Contains(m.Id) || pricedIds.Contains(m.Id))
            .Select(m => new { m.Id, m.Name })
            .ToDictionaryAsync(m => m.Id, m => m.Name);

        var candidates = pricedIds.Where(names.ContainsKey).Select(id => (Id: id, Key: MaterialNameMatch.Prepare(names[id]))).ToList();
        var similarOf = unpricedIds.Where(names.ContainsKey).ToDictionary(id => id, id =>
        {
            var key = MaterialNameMatch.Prepare(names[id]);
            var similar = candidates.Where(c => c.Id != id && MaterialNameMatch.IsSimilar(key, c.Key)).Select(c => c.Id).ToList();
            // None that close: a second look by keyword.
            return similar.Count > 0 ? similar
                : candidates.Where(c => c.Id != id && MaterialNameMatch.IsKeywordMatch(key, c.Key)).Select(c => c.Id).ToList();
        });
        var similarIds = similarOf.Values.SelectMany(v => v).Distinct().ToList();
        if (similarIds.Count == 0) return [];

        var system = (await db.PurchaseOrderMaterials
                .Where(m => m.UnitPrice != null && m.MaterialId != null && similarIds.Contains(m.MaterialId.Value)
                    && m.PurchaseOrder.Status != PurchaseOrderStatus.Cancelled)
                .Select(m => new { MaterialId = m.MaterialId!.Value, m.Unit, Price = m.UnitPrice!.Value, Date = m.PurchaseOrder.OrderDate, m.Id, m.PurchaseOrder.Number, Supplier = m.PurchaseOrder.Supplier.Name })
                .ToListAsync())
            .Select(m => new PoPrice(m.MaterialId, m.Unit, m.Price, m.Date, m.Id, SourcePo, $"{m.Number} · {m.Supplier}"));
        var historical = (await db.HistoricalMaterialSupplies
                .Where(h => h.UnitCost != null && similarIds.Contains(h.BOQItem.MaterialId))
                .Select(h => new { h.BOQItem.MaterialId, h.Unit, Price = h.UnitCost!.Value, Date = h.PoDate ?? h.BOQItem.Project.TargetEndDate, h.Id, Project = h.BOQItem.Project.Name, h.PoNumber })
                .ToListAsync())
            .Select(h => new PoPrice(h.MaterialId, h.Unit, h.Price, h.Date, h.Id, SourceHistorical,
                string.IsNullOrWhiteSpace(h.PoNumber) ? h.Project : $"{h.PoNumber} · {h.Project}"));
        var all = system.Concat(historical).ToList();

        var result = new Dictionary<(int, string), DatedPrice>();
        foreach (var (target, similar) in similarOf)
        {
            var set = similar.ToHashSet();
            foreach (var g in all.Where(p => set.Contains(p.MaterialId)).GroupBy(p => CompletedProjectDemandRules.NormalizeUnit(p.Unit)))
            {
                var latestDay = g.Max(p => p.Date.Date);
                var pick = g.Where(p => p.Date.Date == latestDay).OrderBy(p => p.Price).ThenByDescending(p => p.Id).First();
                result[(target, g.Key)] = new DatedPrice(pick.Price, pick.Date, SourceSimilar,
                    $"{names.GetValueOrDefault(pick.MaterialId)} · {pick.Reference}");
            }
        }
        return result;
    }

    private record PoPrice(int MaterialId, string Unit, decimal Price, DateTime Date, int Id, string Source, string Reference);

    // Per (material, normalized unit): the PO price from the latest order
    // date; several POs that day (different suppliers) → the lowest price.
    // Id breaks a remaining tie so the most recently entered record wins.
    private static Dictionary<(int, string), DatedPrice> LatestLowestByKey(IEnumerable<PoPrice> prices) =>
        prices
            .GroupBy(p => (p.MaterialId, CompletedProjectDemandRules.NormalizeUnit(p.Unit)))
            .ToDictionary(
                g => g.Key,
                g =>
                {
                    var latestDay = g.Max(p => p.Date.Date);
                    var pick = g.Where(p => p.Date.Date == latestDay)
                        .OrderBy(p => p.Price).ThenByDescending(p => p.Id)
                        .First();
                    return new DatedPrice(pick.Price, pick.Date, pick.Source, pick.Reference);
                });
}
