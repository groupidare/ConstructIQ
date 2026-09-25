using System.Text.RegularExpressions;
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
            .Include(b => b.HistoricalSupplies).ThenInclude(h => h.Supplier)
            .Where(b => b.ProjectId == projectId)
            .ToListAsync();

        return rows.Select(ToDto);
    }

    public async Task<IEnumerable<BOQItemResponseDto>> BulkSaveAsync(int projectId, List<BOQItemUpsertDto> items, int userId)
    {
        var project = await db.Projects.FindAsync(projectId)
            ?? throw new InvalidOperationException("Project not found.");

        // Real completed projects need a real Purchase Order on file before their
        // Material Plan can be saved — historical backfills are training data,
        // not real procurement-tracked projects, so they're exempt.
        if (project.Status == ProjectStatus.Completed && !project.IsHistorical)
        {
            var hasPurchaseOrder = await db.PurchaseOrders.AnyAsync(po => po.ProjectId == projectId);
            if (!hasPurchaseOrder)
                throw new InvalidOperationException(
                    "This project is marked Completed and needs at least one Purchase Order on file before the Material Plan can be saved.");
        }

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

            // Prefer the incoming row's own Unit (correct for scanned/unmatched rows)
            // over the catalog Material's Unit, which may differ or not yet be loaded.
            var unitForRow = !string.IsNullOrWhiteSpace(item.Unit)
                ? item.Unit
                : await db.Materials.Where(m => m.Id == materialId).Select(m => m.Unit).FirstOrDefaultAsync();

            entity.PhaseId           = item.PhaseId;
            entity.MaterialId        = materialId;
            entity.PrimarySection    = item.PrimarySection;
            entity.SubCategory       = item.SubCategory;
            entity.EstimatedQuantity = item.EstimatedQuantity;
            entity.CoverageArea      = BOQUnitRules.IsAreaUnit(unitForRow) ? item.EstimatedQuantity : null;
            entity.ActualQuantity    = item.ActualQuantity ?? 0;
            entity.Notes             = item.Notes;
            entity.EstimatedPurchaseQuantity = item.EstimatedPurchaseQuantity;
            entity.EstimatedPurchaseUnit     = item.EstimatedPurchaseUnit;
            entity.UpdatedAt         = DateTime.UtcNow;

            saved.Add(entity);
            await db.SaveChangesAsync(); // need entity.Id below for a new row

            // Full-replace the historical supply lines for this row — a scan
            // is always a fresh snapshot of the source file, not an upsert.
            if (item.HistoricalSupply is not null)
            {
                var existingSupplies = await db.HistoricalMaterialSupplies
                    .Where(h => h.BOQItemId == entity.Id)
                    .ToListAsync();
                db.HistoricalMaterialSupplies.RemoveRange(existingSupplies);

                foreach (var line in item.HistoricalSupply)
                {
                    int? supplierId = !string.IsNullOrWhiteSpace(line.SupplierName)
                        ? await FindOrCreateSupplierAsync(line.SupplierName)
                        : null;

                    db.HistoricalMaterialSupplies.Add(new HistoricalMaterialSupply
                    {
                        BOQItemId    = entity.Id,
                        SupplierId   = supplierId,
                        PoNumber     = line.PoNumber,
                        MaterialName = line.MaterialName,
                        Unit         = line.Unit,
                        Quantity     = line.Quantity,
                    });
                }
                await db.SaveChangesAsync();
            }
        }

        var ids = saved.Select(s => s.Id).ToList();
        var reloaded = await db.BOQItems
            .Include(b => b.Material)
            .Include(b => b.Phase)
            .Include(b => b.HistoricalSupplies).ThenInclude(h => h.Supplier)
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
    //
    // Exact-name match is tried first, then a fuzzy (word-overlap) match
    // against the whole catalog before giving up and creating a new entry —
    // a scanned BOQ description ("CHB (150mm) + Plaster (25mm) + Paint
    // Finish") essentially never matches a catalog material's own short name
    // ("CHB 150mm") verbatim, but they're the same material. Resolving to a
    // brand-new near-duplicate Material instead would carry zero real
    // Inventory stock, silently breaking Stock on Hand/shortage/alerts for
    // every scanned row that isn't an exact string match.
    private async Task<int> FindOrCreateMaterialAsync(string name, string? unit)
    {
        var trimmed = name.Trim();
        var existing = await db.Materials.FirstOrDefaultAsync(m => m.Name.ToLower() == trimmed.ToLower());
        if (existing is not null) return existing.Id;

        var candidates = await db.Materials.Select(m => new { m.Id, m.Name }).ToListAsync();
        var fuzzyMatch = candidates
            .Select(m => new { m.Id, Overlap = TokenOverlap(m.Name, trimmed) })
            .Where(m => m.Overlap.Shared >= 2 && m.Overlap.Ratio >= 0.5)
            .OrderByDescending(m => m.Overlap.Ratio)
            .ThenByDescending(m => m.Overlap.Shared)
            .FirstOrDefault();
        if (fuzzyMatch is not null) return fuzzyMatch.Id;

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

    // Mirrors PurchaseOrdersController's supplier find-or-create-by-name — the
    // only way new suppliers enter the system, kept consistent everywhere a
    // free-text supplier name needs to resolve to a real Supplier row.
    private async Task<int> FindOrCreateSupplierAsync(string name)
    {
        var trimmed = name.Trim();
        var existing = await db.Suppliers.FirstOrDefaultAsync(s => s.Name.ToLower() == trimmed.ToLower());
        if (existing is not null) return existing.Id;

        var supplier = new Supplier { Name = trimmed };
        db.Suppliers.Add(supplier);
        await db.SaveChangesAsync();
        return supplier.Id;
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
        CoverageArea      = b.CoverageArea,
        ActualQuantity    = b.ActualQuantity,
        Notes             = b.Notes,
        CreatedAt         = b.CreatedAt,
        HistoricalSupply  = b.HistoricalSupplies.Select(h => new HistoricalSupplyResponseDto
        {
            Id           = h.Id,
            SupplierId   = h.SupplierId,
            SupplierName = h.Supplier?.Name,
            PoNumber     = h.PoNumber,
            MaterialName = h.MaterialName,
            Unit         = h.Unit,
            Quantity     = h.Quantity,
        }).ToList(),
        EstimatedPurchaseQuantity = b.EstimatedPurchaseQuantity,
        EstimatedPurchaseUnit     = b.EstimatedPurchaseUnit,
    };

    // Units a real historical PO line can carry — mirrors the frontend's Est.
    // Qty unit dropdown. Originally restricted to purchasable containers only
    // (pc/bag/sheet/...), on the assumption measurement units (sq.m, l.m,
    // cu.m) weren't real order quantities — but real extracted PO data proved
    // that wrong (roofing sheets, gutters, and pipe are genuinely ordered by
    // sq.m/l.m in the actual historical reports), which was silently blocking
    // a real, available match for those rows.
    private static readonly HashSet<string> PurchaseUnits = new(StringComparer.OrdinalIgnoreCase)
    { "pc", "bag", "sheet", "pail", "gal", "roll", "set", "box", "sq.m", "l.m", "cu.m", "lot", "kg", "pack" };

    private static string NormalizeSection(string? s) =>
        Regex.Replace((s ?? string.Empty).Trim(), @"^\d+[\.\)]?\s*", string.Empty).ToLowerInvariant();

    // Word-set overlap, not substring containment — a scanned BOQ's wording
    // ("150mm CHB + 25mm plaster + paint") and a real PO line's own wording
    // for the same material ("CHB, 150mm thick, Class A") share key tokens
    // (chb, 150mm) but neither text is a substring of the other, so a plain
    // Contains check (the original approach here) never matched real data at
    // all — this only surfaced once tested against actual historical rows.
    private static HashSet<string> Tokenize(string? s) =>
        Regex.Matches((s ?? string.Empty).ToLowerInvariant(), @"[a-z0-9]+")
            .Select(m => m.Value)
            .Where(t => t.Length >= 2)
            .ToHashSet();

    private static (int Shared, double Ratio) TokenOverlap(string? a, string? b)
    {
        var tokensA = Tokenize(a);
        var tokensB = Tokenize(b);
        if (tokensA.Count == 0 || tokensB.Count == 0) return (0, 0);
        var shared = tokensA.Intersect(tokensB).Count();
        return (shared, (double)shared / Math.Min(tokensA.Count, tokensB.Count));
    }

    private static bool FuzzyMatch(string? a, string? b, double minRatio, int minShared)
    {
        var (shared, ratio) = TokenOverlap(a, b);
        return shared >= minShared && ratio >= minRatio;
    }

    // Suggests a procurement Est. Qty/Unit for a new-project BOQ row by looking
    // at real purchase-order lines (HistoricalMaterialSupply, extracted from
    // completed/historical projects' combined BOQ+PO reports) whose parent BOQ
    // line has a matching Primary Section and whose own material name fuzzy-
    // matches the row's Material Specification. Same Project Type is a soft
    // preference — used to narrow the pool when available, never a hard filter.
    public async Task<HistoricalEstimateResponseDto> GetHistoricalEstimateAsync(string primarySection, string materialDescription, string? projectType)
    {
        var normSection = NormalizeSection(primarySection);
        if (normSection.Length == 0 || string.IsNullOrWhiteSpace(materialDescription))
            return new HistoricalEstimateResponseDto();

        var supplies = await db.HistoricalMaterialSupplies
            .Include(s => s.BOQItem).ThenInclude(b => b.Project)
            .Where(s => s.BOQItem.Project.IsHistorical)
            .ToListAsync();

        bool SectionMatches(string? section) => FuzzyMatch(NormalizeSection(section), normSection, 0.5, 1);
        // 0.4, not 0.5 — real near-misses (e.g. "PPR 25mm diameter, pressure-rated"
        // vs. an actual PO line "PPR Pipe, 20mm dia. x 4m") only share ~40% of
        // their tokens once a differing dimension knocks out one shared word,
        // but they're still clearly the same material family.
        bool DescMatches(string name) => FuzzyMatch(name, materialDescription, 0.4, 2);

        var matches = supplies
            .Where(s => PurchaseUnits.Contains(s.Unit.Trim()) && SectionMatches(s.BOQItem.PrimarySection) && DescMatches(s.MaterialName))
            .ToList();

        if (matches.Count == 0) return new HistoricalEstimateResponseDto { MatchCount = 0 };

        var sameType = Enum.TryParse<ProjectType>(projectType, true, out var parsedType)
            ? matches.Where(s => s.BOQItem.Project.Type == parsedType).ToList()
            : [];

        var pool = sameType.Count > 0 ? sameType : matches;
        var avgQty = pool.Average(s => s.Quantity);
        var unit = pool.GroupBy(s => s.Unit.Trim().ToLowerInvariant())
            .OrderByDescending(g => g.Count())
            .First().Key;

        return new HistoricalEstimateResponseDto
        {
            EstimatedQuantity = Math.Round(avgQty, 2),
            Unit = unit,
            MatchCount = matches.Count,
        };
    }
}
