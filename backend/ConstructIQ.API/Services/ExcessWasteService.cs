using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ExcessWasteService(AppDbContext db) : IExcessWasteService
{
    public async Task<IEnumerable<ExcessWasteResponseDto>> GetByProjectAsync(int projectId)
    {
        var records = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.RecordedBy)
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

        return records.Select(e => ToDto(e, redistributionByRecordId.GetValueOrDefault(e.Id)));
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

        int materialId;
        if (dto.MaterialId.HasValue)
            materialId = dto.MaterialId.Value;
        else if (!string.IsNullOrWhiteSpace(dto.NewMaterialName))
            materialId = await FindOrCreateMaterialAsync(dto.NewMaterialName, dto.Unit);
        else
            throw new InvalidOperationException("Each excess entry needs either an existing MaterialId or a NewMaterialName.");

        // A specific BOQ line (the new picker-driven flow) takes priority; the
        // old best-effort match-by-material stays as a fallback for the
        // free-text path so nothing regresses for callers that don't send one.
        var boqItem = dto.BOQItemId.HasValue
            ? await db.BOQItems.FirstOrDefaultAsync(b => b.Id == dto.BOQItemId.Value && b.ProjectId == dto.ProjectId)
            : null;
        if (boqItem is null)
        {
            var boqQuery = db.BOQItems.Where(b => b.ProjectId == dto.ProjectId && b.MaterialId == materialId);
            boqItem = dto.PhaseId.HasValue
                ? await boqQuery.FirstOrDefaultAsync(b => b.PhaseId == dto.PhaseId.Value) ?? await boqQuery.FirstOrDefaultAsync()
                : await boqQuery.FirstOrDefaultAsync();
        }

        var excessPercent = boqItem is not null && boqItem.EstimatedQuantity > 0
            ? dto.Quantity / boqItem.EstimatedQuantity * 100
            : 0;

        // Validated against what was actually delivered (falling back to the
        // estimate only if nothing's been marked Delivered yet) instead of
        // the original plan — a project that genuinely over-procured can log
        // Excess+Waste past its original estimate without this rejecting a
        // real entry. Rejected outright rather than silently clamped, so an
        // over-limit entry never enters the log at all.
        if (boqItem is not null)
        {
            var baseline = await GetDeliveredBaselineAsync(boqItem);
            var alreadyLogged = await db.ExcessWasteRecords
                .Where(e => e.BOQItemId == boqItem.Id)
                .SumAsync(e => (decimal?)e.Quantity) ?? 0;
            if (alreadyLogged + dto.Quantity > baseline)
                throw new InvalidOperationException(
                    $"This entry would bring total logged Excess+Waste to {alreadyLogged + dto.Quantity} {(boqItem.EstimatedPurchaseUnit ?? boqItem.Unit ?? "")}, exceeding the {baseline} delivered (or estimated, if nothing's been delivered yet) — reduce the quantity or confirm the delivery was recorded.");
        }

        var record = new ExcessWasteRecord
        {
            ProjectId       = dto.ProjectId,
            PhaseId         = dto.PhaseId,
            BOQItemId       = boqItem?.Id,
            MaterialId      = materialId,
            ExcessType      = Enum.Parse<ExcessType>(dto.ExcessType),
            Quantity        = dto.Quantity,
            UnitCost        = dto.UnitCost,
            TotalCost       = dto.Quantity * dto.UnitCost,
            ExcessPercent   = excessPercent,
            IsReusable      = dto.IsReusable,
            Notes           = dto.Notes,
            RecordedByUserId= userId,
        };

        db.ExcessWasteRecords.Add(record);

        var inventory = await db.InventoryRecords
            .FirstOrDefaultAsync(r => r.ProjectId == dto.ProjectId && r.MaterialId == materialId);
        if (inventory is not null)
        {
            inventory.ExcessQuantity += dto.Quantity;
            if (!dto.IsReusable)
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
                .SumAsync(e => e.Quantity);
            boqItem.ActualQuantity = Math.Round(Math.Max(0, baseline - totalLogged), 0, MidpointRounding.AwayFromZero);
            // A record was just added above, so a real log now definitely
            // exists for this line — this value is observed, not assumed.
            boqItem.IsUsageConfirmed = true;
            boqItem.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        var saved = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.RecordedBy)
            .FirstAsync(e => e.Id == record.Id);

        return ToDto(saved);
    }

    // Every BOQ line for a project that has no ExcessWasteRecord of the
    // SAME kind (Excess vs. Waste, per isReusable) linked to it yet. Scoped
    // per-kind rather than "any record at all" — logging Excess against a
    // line must not block later logging Waste against that same line, and
    // vice versa; both are legitimate, independent facts about one BOQ item.
    public async Task<IEnumerable<PendingBOQItemDto>> GetPendingBOQItemsAsync(int projectId, bool isReusable)
    {
        var loggedBoqItemIds = await db.ExcessWasteRecords
            .Where(e => e.ProjectId == projectId && e.BOQItemId != null && e.IsReusable == isReusable)
            .Select(e => e.BOQItemId!.Value)
            .Distinct()
            .ToListAsync();

        // A material with an undecided redistribution request out of this
        // project can't be re-logged as fresh excess until that request is
        // settled (approved or rejected) — avoids double-bookkeeping while a
        // decision is pending. Once approved (a terminal state), the material
        // is fair game again — e.g. redistributing only part of a batch
        // shouldn't permanently block logging more of it later.
        var pendingSourceMaterialIds = await db.RedistributionRequests
            .Where(r => r.SourceProjectId == projectId && RedistributionStatuses.Pending.Contains(r.Status))
            .Select(r => r.MaterialId)
            .Distinct()
            .ToListAsync();

        var items = await db.BOQItems
            .Include(b => b.Material)
            .Where(b => b.ProjectId == projectId
                && !loggedBoqItemIds.Contains(b.Id)
                && !pendingSourceMaterialIds.Contains(b.MaterialId))
            .ToListAsync();

        return items.Select(b => new PendingBOQItemDto
        {
            BOQItemId         = b.Id,
            MaterialId        = b.MaterialId,
            MaterialName      = b.Material.Name,
            Unit              = b.EstimatedPurchaseUnit ?? b.Material.Unit,
            EstimatedQuantity = b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity,
        });
    }

    // Every Project that still has at least one BOQ line missing an Excess OR
    // a Waste record — one bulk query rather than looping GetPendingBOQItemsAsync
    // per project, since a project with none of these is a dead end in the
    // Record Material Excess modal (always lands on "No materials left to
    // log") and should never appear in its project picker at all.
    public async Task<IEnumerable<int>> GetProjectIdsWithPendingItemsAsync()
    {
        var boqItems = await db.BOQItems
            .Select(b => new { b.Id, b.ProjectId, b.MaterialId })
            .ToListAsync();

        var excessLogged = (await db.ExcessWasteRecords
                .Where(e => e.BOQItemId != null && e.IsReusable)
                .Select(e => e.BOQItemId!.Value)
                .Distinct()
                .ToListAsync())
            .ToHashSet();
        var wasteLogged = (await db.ExcessWasteRecords
                .Where(e => e.BOQItemId != null && !e.IsReusable)
                .Select(e => e.BOQItemId!.Value)
                .Distinct()
                .ToListAsync())
            .ToHashSet();

        var pendingRedistributionsByProject = (await db.RedistributionRequests
                .Where(r => RedistributionStatuses.Pending.Contains(r.Status))
                .Select(r => new { r.SourceProjectId, r.MaterialId })
                .ToListAsync())
            .ToLookup(r => r.SourceProjectId, r => r.MaterialId);

        return boqItems
            .Where(b => !(excessLogged.Contains(b.Id) && wasteLogged.Contains(b.Id)))
            .Where(b => !pendingRedistributionsByProject[b.ProjectId].Contains(b.MaterialId))
            .Select(b => b.ProjectId)
            .Distinct()
            .ToList();
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
                    .SumAsync(e => (decimal?)e.Quantity) ?? 0;
                if (loggedByOthers + dto.Quantity > baseline)
                    throw new InvalidOperationException(
                        $"This change would bring total logged Excess+Waste to {loggedByOthers + dto.Quantity} {(boqItem.EstimatedPurchaseUnit ?? boqItem.Unit ?? "")}, exceeding the {baseline} delivered (or estimated, if nothing's been delivered yet).");
            }
        }

        record.ExcessType = Enum.Parse<ExcessType>(dto.ExcessType);
        record.Quantity   = dto.Quantity;
        record.TotalCost  = dto.Quantity * record.UnitCost;
        record.IsReusable = dto.IsReusable;

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
                    .SumAsync(e => e.Quantity);
                boqItem.ActualQuantity = Math.Round(Math.Max(0, baseline - totalLogged), 0, MidpointRounding.AwayFromZero);
                boqItem.IsUsageConfirmed = true;
                boqItem.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
            }
        }

        var saved = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.RecordedBy)
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
            var totalLogged = remaining.Sum(e => e.Quantity);
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
        var existing = await db.Materials.FirstOrDefaultAsync(m => m.Name.ToLower() == trimmed.ToLower());
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
        return delivered > 0 ? delivered : (boqItem.EstimatedPurchaseQuantity ?? boqItem.EstimatedQuantity);
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
        Unit         = e.Material?.Unit ?? string.Empty,
        ExcessType   = e.ExcessType.ToString(),
        Quantity     = e.Quantity,
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
}
