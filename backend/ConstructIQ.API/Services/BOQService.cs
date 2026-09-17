using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class BOQService(AppDbContext db) : IBOQService
{
    public async Task<IEnumerable<BOQItemResponseDto>> GetByProjectAsync(int projectId)
    {
        var rows = await db.BOQItems
            .Include(b => b.Material)
            .Include(b => b.Phase)
            .Where(b => b.ProjectId == projectId)
            .ToListAsync();

        return rows.Select(ToDto);
    }

    public async Task<IEnumerable<BOQItemResponseDto>> BulkSaveAsync(int projectId, List<BOQItemUpsertDto> items, int userId)
    {
        var saved = new List<BOQItem>();

        foreach (var item in items)
        {
            int materialId;
            if (item.MaterialId.HasValue)
                materialId = item.MaterialId.Value;
            else if (!string.IsNullOrWhiteSpace(item.NewMaterialName))
                materialId = await FindOrCreateMaterialAsync(item.NewMaterialName, item.Unit);
            else
                throw new InvalidOperationException("Each BOQ row needs either an existing MaterialId or a NewMaterialName.");

            var entity = item.Id.HasValue
                ? await db.BOQItems.FirstOrDefaultAsync(b => b.Id == item.Id && b.ProjectId == projectId)
                : null;

            if (entity is null)
            {
                entity = new BOQItem { ProjectId = projectId, CreatedByUserId = userId };
                db.BOQItems.Add(entity);
            }

            entity.PhaseId           = item.PhaseId;
            entity.MaterialId        = materialId;
            entity.PrimarySection    = item.PrimarySection;
            entity.SubCategory       = item.SubCategory;
            entity.EstimatedQuantity = item.EstimatedQuantity;
            entity.ActualQuantity    = item.ActualQuantity ?? 0;
            entity.Notes             = item.Notes;
            entity.UpdatedAt         = DateTime.UtcNow;

            saved.Add(entity);
        }

        await db.SaveChangesAsync();

        var ids = saved.Select(s => s.Id).ToList();
        var reloaded = await db.BOQItems
            .Include(b => b.Material)
            .Include(b => b.Phase)
            .Where(b => ids.Contains(b.Id))
            .ToListAsync();
        return reloaded.Select(ToDto);
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var item = await db.BOQItems.FindAsync(id);
        if (item is null) return false;
        db.BOQItems.Remove(item);
        await db.SaveChangesAsync();
        return true;
    }

    // BOQ rows always need a real MaterialId. Scanned/manually-typed names that
    // don't match the catalog yet get a lightweight new Material under a
    // catch-all "Uncategorized" category rather than blocking the save.
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

    private static BOQItemResponseDto ToDto(BOQItem b) => new()
    {
        Id                = b.Id,
        ProjectId         = b.ProjectId,
        PhaseId           = b.PhaseId,
        PhaseName         = b.Phase?.Name,
        PrimarySection    = b.PrimarySection ?? string.Empty,
        SubCategory       = b.SubCategory,
        MaterialId        = b.MaterialId,
        MaterialName      = b.Material.Name,
        Unit              = b.Material.Unit,
        EstimatedQuantity = b.EstimatedQuantity,
        ActualQuantity    = b.ActualQuantity,
        Notes             = b.Notes,
        CreatedAt         = b.CreatedAt,
    };
}
