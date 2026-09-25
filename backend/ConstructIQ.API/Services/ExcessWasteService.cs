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

        // Actual usage = what was estimated minus everything logged as
        // waste/excess against this exact BOQ line so far (across however
        // many entries) — the whole point of tying this to a real BOQItemId
        // instead of just a material name. Clamped at 0: logging more excess
        // than was ever estimated doesn't make sense as a negative "used".
        if (boqItem is not null)
        {
            var baseline = boqItem.EstimatedPurchaseQuantity ?? boqItem.EstimatedQuantity;
            var totalLogged = await db.ExcessWasteRecords
                .Where(e => e.BOQItemId == boqItem.Id)
                .SumAsync(e => e.Quantity);
            boqItem.ActualQuantity = Math.Max(0, baseline - totalLogged);
            boqItem.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        var saved = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.RecordedBy)
            .FirstAsync(e => e.Id == record.Id);

        return ToDto(saved);
    }

    // Every BOQ line for a project that has no ExcessWasteRecord linked to it
    // yet — this is exactly what the Record Material Excess modal's material
    // picker shows, so a material logged once stops appearing next time.
    public async Task<IEnumerable<PendingBOQItemDto>> GetPendingBOQItemsAsync(int projectId)
    {
        var loggedBoqItemIds = await db.ExcessWasteRecords
            .Where(e => e.ProjectId == projectId && e.BOQItemId != null)
            .Select(e => e.BOQItemId!.Value)
            .Distinct()
            .ToListAsync();

        var items = await db.BOQItems
            .Include(b => b.Material)
            .Where(b => b.ProjectId == projectId && !loggedBoqItemIds.Contains(b.Id))
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

    public async Task<ExcessWasteResponseDto> UpdateAsync(int id, ExcessWasteUpdateDto dto)
    {
        var record = await db.ExcessWasteRecords
            .Include(e => e.Material)
            .FirstOrDefaultAsync(e => e.Id == id)
            ?? throw new KeyNotFoundException("Excess record not found.");

        if (!string.IsNullOrWhiteSpace(dto.NewMaterialName) &&
            !string.Equals(dto.NewMaterialName.Trim(), record.Material.Name, StringComparison.OrdinalIgnoreCase))
        {
            record.MaterialId = await FindOrCreateMaterialAsync(dto.NewMaterialName, dto.Unit);
        }

        record.ExcessType = Enum.Parse<ExcessType>(dto.ExcessType);
        record.Quantity   = dto.Quantity;
        record.TotalCost  = dto.Quantity * record.UnitCost;
        record.IsReusable = dto.IsReusable;

        await db.SaveChangesAsync();

        var saved = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.RecordedBy)
            .FirstAsync(e => e.Id == id);

        return ToDto(saved);
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
