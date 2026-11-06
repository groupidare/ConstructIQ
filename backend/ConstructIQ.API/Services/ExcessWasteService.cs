using ConstructIQ.API.Data;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// sheetSync is optional so tests (and anything else constructing this
// directly) don't need the Google Sheet writer.
public class ExcessWasteService(AppDbContext db, IExcessSheetSync? sheetSync = null) : IExcessWasteService
{
    public async Task<IEnumerable<ExcessWasteResponseDto>> GetByProjectAsync(int projectId)
    {
        var records = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.BOQItem).ThenInclude(b => b!.HistoricalSupplies)
            .Include(e => e.RecordedBy)
            .Where(e => e.ProjectId == projectId)
            .OrderByDescending(e => e.RecordedAt)
            .ToListAsync();

        var recordIds = records.Select(r => r.Id).ToList();
        var redistributionByRecordId = (await db.RedistributionRequests
            .Include(r => r.TargetProject)
            .Where(r => r.SourceExcessWasteRecordId != null
                && recordIds.Contains(r.SourceExcessWasteRecordId.Value)
                && r.Status != RedistributionStatus.Rejected)
            .ToListAsync())
            .GroupBy(r => r.SourceExcessWasteRecordId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.RequestedAt).First());

        var releasesByRecordId = (await db.WarehouseReleaseSources
                .Where(s => recordIds.Contains(s.ExcessWasteRecordId))
                .OrderBy(s => s.Id)
                .Select(s => new { s.ExcessWasteRecordId, ProjectName = s.WarehouseRequest.Project.Name, s.Quantity })
                .ToListAsync())
            .GroupBy(s => s.ExcessWasteRecordId)
            .ToDictionary(g => g.Key, g => g
                .GroupBy(s => s.ProjectName)
                .Select(p => new ExcessWarehouseReleaseDto { ProjectName = p.Key, Quantity = p.Sum(s => s.Quantity) })
                .ToList());

        return records.Select(e =>
        {
            var dto = ToDto(e, redistributionByRecordId.GetValueOrDefault(e.Id));
            dto.WarehouseReleases = releasesByRecordId.GetValueOrDefault(e.Id) ?? [];
            return dto;
        });
    }

    public async Task<ExcessWasteResponseDto> CreateAsync(ExcessWasteCreateDto dto, int userId)
    {
        // Material quantities are always whole units in practice — rounded
        // once here so the validation check below, the saved record, and the
        // inventory/ActualQuantity updates all agree on the same number
        // (rounding only at the save point further down could let the
        // validation check pass against an unrounded value that then rounds
        // up past the baseline it was just checked against).
        dto.Quantity = Math.Round(dto.Quantity, 0, MidpointRounding.AwayFromZero);

        if (!dto.BOQItemId.HasValue)
            throw new InvalidOperationException(
                "Select the specific BOQ material line this excess or waste belongs to.");

        var boqItem = await db.BOQItems
            .Include(b => b.HistoricalSupplies)
            .FirstOrDefaultAsync(b => b.Id == dto.BOQItemId.Value && b.ProjectId == dto.ProjectId)
            ?? throw new InvalidOperationException(
                "The selected BOQ material line was not found in this project.");

        var materialId = boqItem.MaterialId;
        if (dto.MaterialId.HasValue && dto.MaterialId.Value != materialId)
            throw new InvalidOperationException(
                "The selected material does not match the selected BOQ material line.");

        var excessPercent = 0m;

        // Validated against what was actually delivered (falling back to the
        // estimate only if nothing's been marked Delivered yet) instead of
        // the original plan — a project that genuinely over-procured can log
        // Excess+Waste past its original estimate without this rejecting a
        // real entry. Rejected outright rather than silently clamped, so an
        // over-limit entry never enters the log at all.
        if (boqItem is not null)
        {
            var baseline = await GetDeliveredBaselineAsync(boqItem);
            excessPercent = baseline > 0 ? dto.Quantity / baseline * 100 : 0;
            var alreadyLogged = await db.ExcessWasteRecords
                .Where(e => e.BOQItemId == boqItem.Id)
                .SumAsync(e => (decimal?)(e.Quantity + e.RedistributedQuantity)) ?? 0;
            if (alreadyLogged + dto.Quantity > baseline)
                throw new InvalidOperationException(
                    $"This entry would bring total logged Excess+Waste to {alreadyLogged + dto.Quantity} {(boqItem.EstimatedPurchaseUnit ?? boqItem.Unit ?? "")}, exceeding the {baseline} delivered (or estimated, if nothing's been delivered yet) — reduce the quantity or confirm the delivery was recorded.");
        }

        var excessType = Enum.Parse<ExcessType>(dto.ExcessType);
        var isReusable = excessType is ExcessType.Unused or ExcessType.Overordered;

        var record = new ExcessWasteRecord
        {
            ProjectId       = dto.ProjectId,
            PhaseId         = dto.PhaseId,
            BOQItemId       = boqItem?.Id,
            MaterialId      = materialId,
            ExcessType      = excessType,
            Quantity        = dto.Quantity,
            UnitCost        = dto.UnitCost,
            TotalCost       = dto.Quantity * dto.UnitCost,
            ExcessPercent   = excessPercent,
            IsReusable      = isReusable,
            Notes           = dto.Notes,
            RecordedByUserId= userId,
            // Excess goes back into warehouse stock, so it's written to the
            // Google Sheet's STOCK IN; waste never is.
            SheetSyncPending = isReusable && sheetSync?.Enabled == true,
        };

        db.ExcessWasteRecords.Add(record);

        var inventory = await db.InventoryRecords
            .FirstOrDefaultAsync(r => r.ProjectId == dto.ProjectId && r.MaterialId == materialId);
        if (inventory is not null)
        {
            inventory.ExcessQuantity += dto.Quantity;
            if (!isReusable)
            {
                inventory.WastedQuantity    += dto.Quantity;
                inventory.AvailableQuantity -= dto.Quantity;
            }
        }

        await db.SaveChangesAsync();

        // Actual usage = what was actually delivered minus everything logged
        // as waste/excess against this exact BOQ line so far — grounded in
        // real receipts rather than the plan, so it can legitimately exceed
        // the original estimate when a project over-procured. Clamped at 0:
        // logging more excess than was ever delivered doesn't make sense as
        // a negative "used".
        if (boqItem is not null)
        {
            var baseline = await GetDeliveredBaselineAsync(boqItem);
            var totalLogged = await db.ExcessWasteRecords
                .Where(e => e.BOQItemId == boqItem.Id)
                .SumAsync(e => e.Quantity + e.RedistributedQuantity);
            boqItem.ActualQuantity = Math.Round(Math.Max(0, baseline - totalLogged), 0, MidpointRounding.AwayFromZero);
            // A record was just added above, so a real log now definitely
            // exists for this line — this value is observed, not assumed.
            boqItem.IsUsageConfirmed = true;
            boqItem.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        if (record.SheetSyncPending) sheetSync!.Trigger();

        var saved = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.BOQItem).ThenInclude(b => b!.HistoricalSupplies)
            .Include(e => e.RecordedBy)
            .FirstAsync(e => e.Id == record.Id);

        return ToDto(saved);
    }

    // The Record Material Excess table: every BOQ line of a project except
    // those marked "None" (nothing left over — done). Excess and waste are
    // recorded weekly, so a line that's had some logged stays listed and can
    // take more later (CreateAsync caps the running total at what was
    // delivered). Each line carries its delivered baseline and what's been
    // logged so far, so the table previews the Actual Usage the save stores.
    public async Task<IEnumerable<PendingBOQItemDto>> GetLoggableBOQItemsAsync(int projectId)
    {
        // A material with an undecided redistribution request out of this
        // project can't take fresh excess until that request is settled
        // (approved or rejected) — avoids double-bookkeeping while a decision
        // is pending. Listed, but flagged, so the table can say why.
        var pendingSourceMaterialIds = (await db.RedistributionRequests
                .Where(r => r.SourceProjectId == projectId && RedistributionStatuses.Pending.Contains(r.Status))
                .Select(r => r.MaterialId)
                .Distinct()
                .ToListAsync())
            .ToHashSet();

        var items = await db.BOQItems
            .Include(b => b.Material)
            .Include(b => b.HistoricalSupplies)
            .Where(b => b.ProjectId == projectId && b.NoExcessWasteConfirmedAt == null)
            .OrderBy(b => b.Id)
            .ToListAsync();

        var itemIds = items.Select(b => b.Id).ToList();
        var loggedByItem = (await db.ExcessWasteRecords
                .Where(e => e.BOQItemId != null && itemIds.Contains(e.BOQItemId.Value))
                .Select(e => new { BOQItemId = e.BOQItemId!.Value, e.IsReusable, Quantity = e.Quantity + e.RedistributedQuantity })
                .ToListAsync())
            .ToLookup(e => e.BOQItemId);

        var result = new List<PendingBOQItemDto>();
        foreach (var b in items)
        {
            var logged = loggedByItem[b.Id].ToList();
            result.Add(new PendingBOQItemDto
            {
                BOQItemId                = b.Id,
                MaterialId               = b.MaterialId,
                MaterialName             = b.Material.Name,
                Unit                     = PreferredUnit(b),
                EstimatedQuantity        = PurchaseQuantity(b),
                DeliveredQuantity        = await GetDeliveredBaselineAsync(b),
                AlreadyLogged            = logged.Sum(e => e.Quantity),
                ExcessLogged             = logged.Where(e => e.IsReusable).Sum(e => e.Quantity),
                WasteLogged              = logged.Where(e => !e.IsReusable).Sum(e => e.Quantity),
                RedistributionPending    = pendingSourceMaterialIds.Contains(b.MaterialId),
            });
        }
        return result;
    }

    // Projects with at least one BOQ line not yet marked "None" — the only
    // ones the Record Material Excess project picker can do anything with.
    public async Task<IEnumerable<int>> GetProjectIdsWithBOQItemsAsync() =>
        await db.BOQItems.Where(b => b.NoExcessWasteConfirmedAt == null)
            .Select(b => b.ProjectId).Distinct().ToListAsync();

    // "None" in Record Material Excess: no (more) excess or waste for these
    // BOQ lines — they're done and drop out of later entries. Confirms actual
    // usage as delivered minus whatever was already logged — exactly what a
    // logged record would set, just with nothing added.
    public async Task ConfirmNoExcessWasteAsync(int projectId, IReadOnlyCollection<int> boqItemIds, int userId)
    {
        var items = await db.BOQItems
            .Include(b => b.HistoricalSupplies)
            .Where(b => b.ProjectId == projectId && boqItemIds.Contains(b.Id))
            .ToListAsync();
        if (items.Count != boqItemIds.Distinct().Count())
            throw new InvalidOperationException("One or more of the selected materials were not found in this project.");

        foreach (var boqItem in items)
        {
            var baseline = await GetDeliveredBaselineAsync(boqItem);
            var totalLogged = await db.ExcessWasteRecords
                .Where(e => e.BOQItemId == boqItem.Id)
                .SumAsync(e => (decimal?)(e.Quantity + e.RedistributedQuantity)) ?? 0;
            boqItem.ActualQuantity = Math.Round(Math.Max(0, baseline - totalLogged), 0, MidpointRounding.AwayFromZero);
            boqItem.IsUsageConfirmed = true;
            boqItem.NoExcessWasteConfirmedAt = DateTime.UtcNow;
            boqItem.NoExcessWasteConfirmedByUserId = userId;
            boqItem.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
    }

    public async Task<ExcessWasteResponseDto> UpdateAsync(int id, ExcessWasteUpdateDto dto)
    {
        var record = await db.ExcessWasteRecords
            .Include(e => e.Material)
            .FirstOrDefaultAsync(e => e.Id == id)
            ?? throw new KeyNotFoundException("Excess record not found.");

        var alreadyRedistributed = await db.RedistributionRequests
            .AnyAsync(r => r.SourceExcessWasteRecordId == id && r.Status == RedistributionStatus.Approved);
        if (alreadyRedistributed)
            throw new InvalidOperationException("This entry has already been redistributed and can no longer be edited.");
        if (await db.WarehouseReleaseSources.AnyAsync(s => s.ExcessWasteRecordId == id))
            throw new InvalidOperationException("Part of this entry has already been released by the warehouse, so it can no longer be edited.");

        if (!string.IsNullOrWhiteSpace(dto.NewMaterialName) &&
            !string.Equals(dto.NewMaterialName.Trim(), record.Material.Name, StringComparison.OrdinalIgnoreCase))
        {
            record.MaterialId = await FindOrCreateMaterialAsync(dto.NewMaterialName, dto.Unit);
        }

        if (record.BOQItemId.HasValue)
        {
            var boqItem = await db.BOQItems.FindAsync(record.BOQItemId.Value);
            if (boqItem is not null)
            {
                var baseline = await GetDeliveredBaselineAsync(boqItem);
                var loggedByOthers = await db.ExcessWasteRecords
                    .Where(e => e.BOQItemId == boqItem.Id && e.Id != id)
                    .SumAsync(e => (decimal?)(e.Quantity + e.RedistributedQuantity)) ?? 0;
                if (loggedByOthers + dto.Quantity > baseline)
                    throw new InvalidOperationException(
                        $"This change would bring total logged Excess+Waste to {loggedByOthers + dto.Quantity} {(boqItem.EstimatedPurchaseUnit ?? boqItem.Unit ?? "")}, exceeding the {baseline} delivered (or estimated, if nothing's been delivered yet).");
            }
        }

        record.ExcessType = Enum.Parse<ExcessType>(dto.ExcessType);
        record.Quantity   = dto.Quantity;
        // Only reachable with no approved transfer (checked above), so the
        // edited amount is the whole logged amount.
        record.RedistributedQuantity = 0;
        record.TotalCost  = dto.Quantity * record.UnitCost;
        record.IsReusable = record.ExcessType is ExcessType.Unused or ExcessType.Overordered;

        await db.SaveChangesAsync();

        // Editing a record's own Quantity changes the Excess+Waste total it
        // contributes, so the BOQ line's derived ActualQuantity was going
        // stale here before (only Create/Delete recomputed it) — recompute it
        // the same way those two already do.
        if (record.BOQItemId.HasValue)
        {
            var boqItem = await db.BOQItems.FindAsync(record.BOQItemId.Value);
            if (boqItem is not null)
            {
                var baseline = await GetDeliveredBaselineAsync(boqItem);
                var totalLogged = await db.ExcessWasteRecords
                    .Where(e => e.BOQItemId == boqItem.Id)
                    .SumAsync(e => e.Quantity + e.RedistributedQuantity);
                boqItem.ActualQuantity = Math.Round(Math.Max(0, baseline - totalLogged), 0, MidpointRounding.AwayFromZero);
                boqItem.IsUsageConfirmed = true;
                boqItem.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }
        }

        var saved = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.BOQItem).Include(e => e.RecordedBy)
            .FirstAsync(e => e.Id == id);

        return ToDto(saved);
    }

    public async Task DeleteAsync(int id)
    {
        var record = await db.ExcessWasteRecords
            .Include(e => e.BOQItem)
            .FirstOrDefaultAsync(e => e.Id == id)
            ?? throw new KeyNotFoundException("Excess record not found.");

        var hasActiveRedistribution = await db.RedistributionRequests
            .AnyAsync(r => r.SourceExcessWasteRecordId == id && r.Status != RedistributionStatus.Rejected);
        if (hasActiveRedistribution)
            throw new InvalidOperationException("This entry is linked to a redistribution request and can't be deleted — reject or cancel that request first.");
        if (await db.WarehouseReleaseSources.AnyAsync(s => s.ExcessWasteRecordId == id))
            throw new InvalidOperationException("Part of this entry has already been released by the warehouse, so it can't be deleted.");

        // Symmetric undo of CreateAsync's inventory effects.
        var inventory = await db.InventoryRecords
            .FirstOrDefaultAsync(i => i.ProjectId == record.ProjectId && i.MaterialId == record.MaterialId);
        if (inventory is not null)
        {
            inventory.ExcessQuantity = Math.Max(0, inventory.ExcessQuantity - record.Quantity);
            if (!record.IsReusable)
            {
                inventory.WastedQuantity    = Math.Max(0, inventory.WastedQuantity - record.Quantity);
                inventory.AvailableQuantity += record.Quantity;
            }
        }

        var boqItem = record.BOQItem;
        db.ExcessWasteRecords.Remove(record);
        await db.SaveChangesAsync();

        if (boqItem is not null)
        {
            var baseline = await GetDeliveredBaselineAsync(boqItem);
            var remaining = await db.ExcessWasteRecords
                .Where(e => e.BOQItemId == boqItem.Id)
                .ToListAsync();
            var totalLogged = remaining.Sum(e => e.LoggedQuantity);
            boqItem.ActualQuantity = Math.Round(Math.Max(0, baseline - totalLogged), 0, MidpointRounding.AwayFromZero);
            // Deleting the last remaining record against this line means
            // nothing real is logged anymore — back to unconfirmed, not a
            // silently-still-trusted figure.
            boqItem.IsUsageConfirmed = remaining.Count > 0;
            boqItem.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
    }

    // Mirrors BOQService.FindOrCreateMaterialAsync — entries recorded from a
    // free-text material name get a lightweight new Material rather than
    // blocking the save on a pre-existing catalog match.
    private async Task<int> FindOrCreateMaterialAsync(string name, string? unit)
    {
        var trimmed = name.Trim();
        var canonical = Algorithms.MaterialNames.Canonical(trimmed);
        var existing = (await db.Materials.OrderBy(m => m.Id).Select(m => new { m.Id, m.Name }).ToListAsync())
            .FirstOrDefault(m => Algorithms.MaterialNames.Canonical(m.Name) == canonical);
        if (existing is not null) return existing.Id;

        var uncategorized = await db.MaterialCategories.FirstOrDefaultAsync(c => c.Name == "Uncategorized");
        if (uncategorized is null)
        {
            uncategorized = new MaterialCategory
            {
                Name = "Uncategorized",
                Description = "Auto-created for materials added via BOQ scanning or manual entry, pending proper categorization.",
            };
            db.MaterialCategories.Add(uncategorized);
            await db.SaveChangesAsync();
        }

        var material = new Material
        {
            Name       = trimmed,
            Unit       = string.IsNullOrWhiteSpace(unit) ? "pcs" : unit,
            CategoryId = uncategorized.Id,
            UnitCost   = 0,
            IsActive   = true,
        };
        db.Materials.Add(material);
        await db.SaveChangesAsync();
        return material.Id;
    }

    // "Delivered" PO quantity for this BOQ line, same BOQItemId-then-Material/Phase
    // fallback match training_service.py's supplier_lead_time_days subquery
    // uses — a real, observed receipt rather than the original plan. Falls
    // back to the plan estimate only when nothing's been delivered yet, so a
    // historical/backfilled line without matching POs still gets a usable
    // baseline instead of 0.
    //
    // Only PO lines of this BOQ line's own project count, on both the direct
    // BOQItemId match and the Material/Phase fallback — the fallback used to
    // match on material alone, pulling in unlinked deliveries of the same
    // material to every other project. (A direct link can't be trusted to be
    // same-project on its own either: PurchaseOrdersController.LinkMaterial
    // doesn't check it.) Kept in sync with BOQService.GetDeliveredBaselinesAsync.
    private async Task<decimal> GetDeliveredBaselineAsync(BOQItem boqItem)
    {
        var delivered = await db.PurchaseOrderMaterials
            .Where(pom => pom.PurchaseOrder.Status == PurchaseOrderStatus.Delivered
                && pom.PurchaseOrder.ProjectId == boqItem.ProjectId)
            .Where(pom => pom.BOQItemId == boqItem.Id
                || (pom.BOQItemId == null && pom.MaterialId == boqItem.MaterialId
                    && (pom.PhaseId == boqItem.PhaseId || (pom.PhaseId == null && boqItem.PhaseId == null))))
            .SumAsync(pom => (decimal?)pom.Quantity) ?? 0;
        return delivered > 0 ? delivered : PurchaseQuantity(boqItem);
    }

    public async Task<ExcessAnalyticsSummaryDto> GetSummaryAsync(int projectId)
    {
        var records = await db.ExcessWasteRecords
            .Include(e => e.Material).Include(e => e.Project)
            .Where(e => e.ProjectId == projectId)
            .ToListAsync();

        var projectName = records.FirstOrDefault()?.Project.Name ?? string.Empty;

        return new ExcessAnalyticsSummaryDto
        {
            ProjectId           = projectId,
            ProjectName         = projectName,
            TotalExcessCost     = records.Sum(e => e.TotalCost),
            TotalExcessQuantity = records.Sum(e => e.Quantity),
            ReusableValue       = records.Where(e => e.IsReusable).Sum(e => e.TotalCost),
            ExcessByMaterial    = records.GroupBy(e => e.MaterialId).Select(g => new ExcessByMaterialDto
            {
                MaterialId    = g.Key,
                MaterialName  = g.First().Material.Name,
                TotalQuantity = g.Sum(e => e.Quantity),
                TotalCost     = g.Sum(e => e.TotalCost),
                ExcessPercent = g.Average(e => e.ExcessPercent),
            }).ToList(),
            MonthlyTrend = records
                .GroupBy(e => e.RecordedAt.ToString("yyyy-MM"))
                .Select(g => new MonthlyExcessTrendDto
                {
                    Month         = g.Key,
                    TotalCost     = g.Sum(e => e.TotalCost),
                    TotalQuantity = g.Sum(e => e.Quantity),
                }).OrderBy(t => t.Month).ToList(),
        };
    }

    private static ExcessWasteResponseDto ToDto(ExcessWasteRecord e, RedistributionRequest? redistribution = null) => new()
    {
        Id           = e.Id,
        ProjectId    = e.ProjectId,
        ProjectName  = e.Project?.Name ?? string.Empty,
        PhaseId      = e.PhaseId,
        PhaseName    = e.Phase?.Name ?? string.Empty,
        BOQItemId    = e.BOQItemId,
        MaterialId   = e.MaterialId,
        MaterialName = e.Material?.Name ?? string.Empty,
        Unit         = PreferredUnit(e.BOQItem, e.Material?.Unit),
        ExcessType   = e.ExcessType.ToString(),
        Quantity     = e.Quantity,
        LoggedQuantity = e.LoggedQuantity,
        UnitCost     = e.UnitCost,
        TotalCost    = e.TotalCost,
        ExcessPercent= e.ExcessPercent,
        IsReusable   = e.IsReusable,
        Notes        = e.Notes,
        RecordedBy   = e.RecordedBy is null ? string.Empty : $"{e.RecordedBy.FirstName} {e.RecordedBy.LastName}",
        RecordedAt   = e.RecordedAt,
        RedistributionStatus            = redistribution?.Status.ToString(),
        RedistributionTargetProjectName = redistribution?.TargetProject?.Name,
    };

    // Also the unit MaterialCostService prices an excess record in.
    internal static string PreferredUnit(BOQItem? boqItem, string? materialUnit = null)
    {
        if (!string.IsNullOrWhiteSpace(boqItem?.EstimatedPurchaseUnit))
            return boqItem.EstimatedPurchaseUnit.Trim();

        var supplyUnits = boqItem?.HistoricalSupplies
            .Where(s => s.Quantity > 0 && !string.IsNullOrWhiteSpace(s.Unit))
            .GroupBy(s => CompletedProjectDemandRules.NormalizeUnit(s.Unit))
            .Select(g => g.First().Unit.Trim())
            .ToList();
        if (supplyUnits is { Count: 1 })
            return supplyUnits[0];

        return materialUnit ?? boqItem?.Material?.Unit ?? boqItem?.Unit ?? string.Empty;
    }

    private static decimal PurchaseQuantity(BOQItem boqItem)
    {
        if (boqItem.EstimatedPurchaseQuantity.HasValue)
            return boqItem.EstimatedPurchaseQuantity.Value;

        var supplies = boqItem.HistoricalSupplies
            .Where(s => s.Quantity > 0 && !string.IsNullOrWhiteSpace(s.Unit))
            .ToList();
        var units = supplies
            .GroupBy(s => CompletedProjectDemandRules.NormalizeUnit(s.Unit))
            .ToList();
        return units.Count == 1 ? supplies.Sum(s => s.Quantity) : boqItem.EstimatedQuantity;
    }
}
