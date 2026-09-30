using System.Text.RegularExpressions;
using ConstructIQ.API.Algorithms;
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
            entity.Unit              = unitForRow;
            // Prefer the row's own dedicated spec-column text (when the source
            // sheet had one); otherwise fall back to whatever description text
            // brought it here at all (a scanned material/description column,
            // or a manually-typed name) — mirrors the frontend's own display
            // fallback (row.specification || row.newMaterialName) so what's
            // shown before saving matches what survives a reload.
            entity.Specification     = !string.IsNullOrWhiteSpace(item.Specification) ? item.Specification : item.NewMaterialName;
            entity.EstimatedQuantity = item.EstimatedQuantity;
            entity.CoverageArea      = BOQUnitRules.IsAreaUnit(unitForRow) ? item.EstimatedQuantity : null;
            entity.ActualQuantity    = item.ActualQuantity ?? 0;
            entity.Notes             = item.Notes;
            entity.EstimatedPurchaseQuantity = item.EstimatedPurchaseQuantity;
            entity.EstimatedPurchaseUnit     = item.EstimatedPurchaseUnit;

            // RequestedQuantity is now a display-only running total (Notify
            // Procurement/Warehouse enforce the real cap at the point of
            // request, against MaterialRequests/WarehouseRequests directly —
            // not against this counter). Still a basic sanity bound: it
            // shouldn't be able to claim more was ever asked for than the
            // row's own estimate. Only gated on increases: a legitimate
            // decrease (e.g. correcting a typo) should never be blocked.
            var previousRequested = entity.RequestedQuantity ?? 0;
            if (item.RequestedQuantity.HasValue && item.RequestedQuantity.Value > previousRequested)
            {
                var estimatedTotal = item.EstimatedPurchaseQuantity ?? item.EstimatedQuantity;
                if (item.RequestedQuantity.Value > estimatedTotal)
                    throw new InvalidOperationException($"Requested quantity for this row can't exceed its own estimate of {estimatedTotal}.");
            }
            entity.RequestedQuantity         = item.RequestedQuantity;
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
            .Select(m => new { m.Id, m.Name, Overlap = TokenOverlap(m.Name, trimmed) })
            // A high word-overlap ratio alone isn't enough here — unlike
            // GetHistoricalEstimateAsync's soft "same family" suggestion,
            // this permanently links a BOQ row to a real Material's stock
            // tracking. "Concrete Hollow Block, 150mm" and "..., 100mm" share
            // every other word and would otherwise clear 0.5 easily, silently
            // merging two different-sized materials into one stock entry.
            .Where(m => m.Overlap.Shared >= 2 && m.Overlap.Ratio >= 0.5 && !HasConflictingDimension(m.Name, trimmed))
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
        // Fall back to the catalog Material's unit only for rows saved before
        // BOQItem had its own Unit column (or added directly from Stock on
        // Hand with no row-level unit of their own).
        Unit              = !string.IsNullOrWhiteSpace(b.Unit) ? b.Unit : b.Material.Unit,
        Specification     = b.Specification,
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
        RequestedQuantity         = b.RequestedQuantity,
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

    private static readonly Regex DimensionToken = new(@"^(\d+(?:\.\d+)?)([a-z]+)$", RegexOptions.Compiled);

    // Buckets a token set's dimension-looking tokens ("150mm", "6m", "25kg")
    // by unit suffix, so a rebar row's "16mm" diameter is only ever compared
    // against another row's "mm" tokens — not against an unrelated but
    // matching "6m" length token both rows also happen to share.
    private static Dictionary<string, HashSet<string>> DimensionsByUnit(HashSet<string> tokens)
    {
        var map = new Dictionary<string, HashSet<string>>();
        foreach (var t in tokens)
        {
            var m = DimensionToken.Match(t);
            if (!m.Success) continue;
            if (!map.TryGetValue(m.Groups[2].Value, out var values))
                map[m.Groups[2].Value] = values = [];
            values.Add(m.Groups[1].Value);
        }
        return map;
    }

    // True when both descriptions specify a same-unit dimension (150mm vs
    // 100mm, 16mm vs 10mm, ...) but share none of the values under that
    // unit — a hard signal they're different physical materials, regardless
    // of how much of the surrounding wording overlaps.
    private static bool HasConflictingDimension(string? a, string? b)
    {
        var dimsA = DimensionsByUnit(Tokenize(a));
        var dimsB = DimensionsByUnit(Tokenize(b));
        foreach (var (unit, valuesA) in dimsA)
        {
            if (dimsB.TryGetValue(unit, out var valuesB) && !valuesA.Overlaps(valuesB))
                return true;
        }
        return false;
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

    private record ReconciledBoqItem(
        int BOQItemId, int ProjectId, string ProjectName, bool Finalized,
        int MaterialId, string MaterialName, string Unit, DateTime ReportingMonth,
        decimal EstimatedQuantity, decimal ExcessTotal, decimal WasteTotal, decimal ActualUsage);

    // Shared core of every Forecasting-chart endpoint below: every BOQItem
    // that has at least one linked ExcessWasteRecord (the FK link, never
    // matched by material name), reduced to ONE reporting month per item —
    // the calendar month of its MOST RECENT record — carrying its full,
    // all-records-combined Excess/Waste totals. This is what stops "excess
    // logged in July, waste logged in September" from double-plotting a
    // partial usage figure in two different months (spec requirement): the
    // whole, final calculation lands once, in the month it was last touched.
    // Items failing validation (Excess+Waste > baseline) are returned
    // separately, never silently included or clamped.
    private async Task<(List<ReconciledBoqItem> Valid, List<FlaggedExcessItemDto> Flagged)> GetReconciledBoqItemsAsync(
        int userId, string role, int? materialId, string? unit)
    {
        var recordsQuery = db.ExcessWasteRecords
            .Where(e => e.BOQItemId != null)
            .Include(e => e.BOQItem!).ThenInclude(b => b.Project)
            .Include(e => e.BOQItem!).ThenInclude(b => b.Material)
            .AsQueryable();

        // Same SiteEngineer/ProjectManager scoping as ProjectService.GetAllAsync —
        // this endpoint had none at all before.
        if (role is "SiteEngineer")
            recordsQuery = recordsQuery.Where(e => e.BOQItem!.Project.SiteEngineerId == userId);
        else if (role is "ProjectManager")
            recordsQuery = recordsQuery.Where(e => e.BOQItem!.Project.ProjectManagerId == userId);

        if (materialId.HasValue)
            recordsQuery = recordsQuery.Where(e => e.BOQItem!.MaterialId == materialId.Value);

        var records = await recordsQuery.ToListAsync();

        var valid = new List<ReconciledBoqItem>();
        var flagged = new List<FlaggedExcessItemDto>();

        foreach (var group in records.GroupBy(e => e.BOQItemId!.Value))
        {
            var boqItem = group.First().BOQItem!;
            var project = boqItem.Project;

            // The baseline and unit a record's Quantity is actually
            // denominated in — the exact same precedence the Record
            // Excess/Waste picker (GetPendingBOQItemsAsync) and
            // BOQItem.ActualQuantity already use as ground truth, so the
            // figure computed here is always unit-consistent with what was
            // logged, never mixed with the item's separate EstimatedQuantity/
            // Unit when a purchase-unit baseline was the one actually used.
            var baseline = boqItem.EstimatedPurchaseQuantity ?? boqItem.EstimatedQuantity;
            var effectiveUnit = !string.IsNullOrWhiteSpace(boqItem.EstimatedPurchaseUnit)
                ? boqItem.EstimatedPurchaseUnit
                : boqItem.Material.Unit;
            if (unit is not null && !string.Equals(effectiveUnit, unit, StringComparison.OrdinalIgnoreCase))
                continue;

            var excessTotal = group.Where(e => e.IsReusable).Sum(e => e.Quantity);
            var wasteTotal  = group.Where(e => !e.IsReusable).Sum(e => e.Quantity);

            var result = ActualUsageCalculator.Calculate(baseline, excessTotal, wasteTotal);
            if (!result.IsValid)
            {
                flagged.Add(new FlaggedExcessItemDto
                {
                    BOQItemId = boqItem.Id, ProjectId = project.Id, ProjectName = project.Name,
                    MaterialName = boqItem.Material.Name, Unit = effectiveUnit,
                    EstimatedQuantity = baseline, ExcessTotal = excessTotal, WasteTotal = wasteTotal,
                    Reason = result.ErrorMessage!,
                });
                continue;
            }

            var reportingMonth = group.Max(e => e.RecordedAt);
            valid.Add(new ReconciledBoqItem(
                boqItem.Id, project.Id, project.Name, project.Status == ProjectStatus.Completed || project.IsHistorical,
                boqItem.MaterialId, boqItem.Material.Name, effectiveUnit,
                new DateTime(reportingMonth.Year, reportingMonth.Month, 1),
                baseline, excessTotal, wasteTotal, result.ActualUsage!.Value));
        }

        return (valid, flagged);
    }

    // Real AI model output only — ForecastedMaterial.ForecastedQuantity from
    // ForecastResult, never EstimatedPurchaseQuantity (which is user/BOQ-scan
    // entered, at best auto-suggested from a historical-average heuristic;
    // see GetHistoricalEstimateAsync — it has never been touched by the ML
    // pipeline). Attributed to the calendar month of the run that produced it
    // (GeneratedAt) — there's no target-period field to do better, and this
    // is disclosed in the UI rather than presented as more precise than it is.
    private async Task<Dictionary<(int MaterialId, string Unit, DateTime Month), decimal>> GetMonthlyPredictedTotalsAsync(
        int userId, string role, int? materialId)
    {
        var query = db.ForecastedMaterials
            .Include(fm => fm.Material)
            .Include(fm => fm.ForecastResult).ThenInclude(fr => fr.Project)
            .AsQueryable();

        if (role is "SiteEngineer")
            query = query.Where(fm => fm.ForecastResult.Project.SiteEngineerId == userId);
        else if (role is "ProjectManager")
            query = query.Where(fm => fm.ForecastResult.Project.ProjectManagerId == userId);
        if (materialId.HasValue)
            query = query.Where(fm => fm.MaterialId == materialId.Value);

        var rows = await query.ToListAsync();

        return rows
            .GroupBy(fm => (fm.MaterialId, Unit: fm.Material.Unit, Month: new DateTime(fm.ForecastResult.GeneratedAt.Year, fm.ForecastResult.GeneratedAt.Month, 1)))
            .ToDictionary(g => g.Key, g => g.Sum(fm => fm.ForecastedQuantity));
    }

    // Drives the Forecasting page's chart for one selected material+unit (or
    // every material if none is selected). Actual Usage is a monthly TOTAL
    // (sum, not average) of every reconciled BOQItem's calculated usage whose
    // reporting month falls in that bucket; AI Predicted is a monthly total
    // of real forecast-run output for the same material+unit. Either side is
    // null — never zero — when nothing that month has that figure.
    public async Task<IEnumerable<MonthlyDemandSummaryDto>> GetMonthlyDemandSummaryAsync(int userId, string role, int? materialId, string? unit)
    {
        var (valid, _) = await GetReconciledBoqItemsAsync(userId, role, materialId, unit);
        var predicted = await GetMonthlyPredictedTotalsAsync(userId, role, materialId);

        var actualByKey = valid
            .GroupBy(r => (r.MaterialId, r.Unit, Month: r.ReportingMonth))
            .ToDictionary(g => g.Key, g => g.ToList());

        var keys = actualByKey.Keys.Concat(predicted.Keys).Distinct().OrderBy(k => k.Month);

        return keys.Select(key =>
        {
            var items = actualByKey.GetValueOrDefault(key);
            return new MonthlyDemandSummaryDto
            {
                Month       = key.Month.ToString("yyyy-MM"),
                MonthLabel  = key.Month.ToString("MMMM yyyy"),
                MaterialId  = key.MaterialId,
                MaterialName = items?.FirstOrDefault()?.MaterialName ?? string.Empty,
                Unit        = key.Unit,
                ActualUsage = items is null ? null : Math.Round(items.Sum(i => i.ActualUsage), 2),
                AiPredicted = predicted.TryGetValue(key, out var p) ? Math.Round(p, 2) : null,
                ReconciliationStatus = items is null ? null : (items.All(i => i.Finalized) ? "Finalized" : "Provisional"),
                ContributingProjects = items?.Select(i => i.ProjectName).Distinct().ToList() ?? [],
                EstimatedTotal = items is null ? null : items.Sum(i => i.EstimatedQuantity),
                ExcessTotal    = items is null ? null : items.Sum(i => i.ExcessTotal),
                WasteTotal     = items is null ? null : items.Sum(i => i.WasteTotal),
            };
        });
    }

    public async Task<IEnumerable<MaterialOptionDto>> GetMaterialOptionsAsync(int userId, string role)
    {
        var (valid, _) = await GetReconciledBoqItemsAsync(userId, role, null, null);
        return valid
            .GroupBy(r => (r.MaterialId, r.Unit))
            .Select(g => new MaterialOptionDto
            {
                MaterialId = g.Key.MaterialId,
                MaterialName = g.First().MaterialName,
                Unit = g.Key.Unit,
                TotalHistoricalDemand = g.Sum(r => r.ActualUsage),
            })
            .OrderByDescending(m => m.TotalHistoricalDemand)
            .ThenBy(m => m.MaterialName);
    }

    public async Task<IEnumerable<FlaggedExcessItemDto>> GetFlaggedExcessItemsAsync(int userId, string role)
    {
        var (_, flagged) = await GetReconciledBoqItemsAsync(userId, role, null, null);
        return flagged;
    }
}
