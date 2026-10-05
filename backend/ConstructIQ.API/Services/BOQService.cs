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

        var fulfillment = await ProcurementCapCalculator.GetNetLeftToOrderForProjectAsync(db, projectId);
        var remainingRequestable = await ProcurementCapCalculator.GetRemainingRequestableForProjectAsync(db, projectId);
        return rows.Select(b => ToDto(b, fulfillment, remainingRequestable));
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
            // Material quantities are always whole units in practice (you can't
            // order 0.7 of a bag of cement) — rounded here, at the single save
            // choke point every row passes through regardless of where it came
            // from (manual entry, BOQ scan, or the historical-estimate average).
            entity.EstimatedQuantity = Math.Round(item.EstimatedQuantity, 0, MidpointRounding.AwayFromZero);
            entity.CoverageArea      = BOQUnitRules.IsAreaUnit(unitForRow) ? entity.EstimatedQuantity : null;
            entity.ActualQuantity    = Math.Round(item.ActualQuantity ?? 0, 0, MidpointRounding.AwayFromZero);
            // A real number here (the historical-backfill Actual Qty entry —
            // the only place a human still types this) confirms it. Never
            // downgrade to false on a save that simply didn't carry one —
            // e.g. re-saving the Material Plan after editing an unrelated
            // field must not erase a confirmation ExcessWasteService already
            // established for this same row from real logged records.
            if (item.ActualQuantity is > 0)
                entity.IsUsageConfirmed = true;
            entity.Notes             = item.Notes;
            entity.EstimatedPurchaseQuantity = item.EstimatedPurchaseQuantity.HasValue
                ? Math.Round(item.EstimatedPurchaseQuantity.Value, 0, MidpointRounding.AwayFromZero)
                : null;
            entity.EstimatedPurchaseUnit     = item.EstimatedPurchaseUnit;

            // RequestedQuantity is now a display-only running total (Notify
            // Procurement/Warehouse enforce the real cap at the point of
            // request, against MaterialRequests/WarehouseRequests directly —
            // not against this counter). Still a basic sanity bound: it
            // shouldn't be able to claim more was ever asked for than the
            // row's own estimate. Only gated on increases: a legitimate
            // decrease (e.g. correcting a typo) should never be blocked.
            var requestedQuantity = item.RequestedQuantity.HasValue
                ? Math.Round(item.RequestedQuantity.Value, 0, MidpointRounding.AwayFromZero)
                : (decimal?)null;
            var previousRequested = entity.RequestedQuantity ?? 0;
            if (requestedQuantity.HasValue && requestedQuantity.Value > previousRequested)
            {
                var estimatedTotal = entity.EstimatedPurchaseQuantity ?? entity.EstimatedQuantity;
                if (requestedQuantity.Value > estimatedTotal)
                    throw new InvalidOperationException($"Requested quantity for this row can't exceed its own estimate of {estimatedTotal}.");
            }
            entity.RequestedQuantity         = requestedQuantity;
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
                        Quantity     = Math.Round(line.Quantity, 0, MidpointRounding.AwayFromZero),
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

        var fulfillment = await ProcurementCapCalculator.GetNetLeftToOrderForProjectAsync(db, projectId);
        var remainingRequestable = await ProcurementCapCalculator.GetRemainingRequestableForProjectAsync(db, projectId);
        return reloaded.Select(b => ToDto(b, fulfillment, remainingRequestable));
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

    private static BOQItemResponseDto ToDto(BOQItem b, Dictionary<int, (decimal NetLeftToOrder, bool WarehouseApproved)> fulfillment, Dictionary<int, decimal> remainingRequestable)
    {
        var f = fulfillment.TryGetValue(b.MaterialId, out var found)
            ? found
            : (NetLeftToOrder: b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity, WarehouseApproved: false);
        var remaining = remainingRequestable.TryGetValue(b.MaterialId, out var r)
            ? r
            : b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity;
        return new()
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
        IsUsageConfirmed  = b.IsUsageConfirmed,
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
        NetLeftToOrder            = f.NetLeftToOrder,
        WarehouseApproved         = f.WarehouseApproved,
        RemainingRequestable      = remaining,
    };
    }

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
            EstimatedQuantity = Math.Round(avgQty, 0, MidpointRounding.AwayFromZero),
            Unit = unit,
            MatchCount = matches.Count,
        };
    }

    private record ReconciledBoqItem(
        int BOQItemId, int ProjectId, string ProjectName,
        int MaterialId, string MaterialName, string Unit, DateTime ReportingMonth,
        decimal EstimatedQuantity, decimal ExcessTotal, decimal WasteTotal, decimal ActualUsage);

    // IsBackfilled: entered via "Add Completed Project" rather than finished
    // through the app — told apart by never having logged a 100% progress
    // update (IsHistorical alone can't, ProjectService sets it for both).
    private record CompletedProject(string Name, DateTime CompletedAt, bool IsBackfilled);

    private sealed class PredictedTotal
    {
        public string MaterialName { get; init; } = string.Empty;
        public string Unit         { get; init; } = string.Empty;
        public decimal Quantity    { get; set; }
        public HashSet<int> ProjectIds { get; } = [];
    }

    // The Forecasting chart only ever shows FINISHED projects — every
    // Completed project this user can see (same SiteEngineer/ProjectManager
    // scoping as ProjectService.GetAllAsync), each with the date it finished
    // (see CompletedProjectDemandRules.ResolveCompletionDate). Active and
    // Planning projects never appear, even with Excess/Waste already logged;
    // they show up once they're done. Two queries total, never one per project.
    private async Task<Dictionary<int, CompletedProject>> GetCompletedProjectsAsync(int userId, string role)
    {
        var query = db.Projects.Where(p => p.Status == ProjectStatus.Completed);
        if (role is "SiteEngineer")
            query = query.Where(p => p.SiteEngineerId == userId);
        else if (role is "ProjectManager")
            query = query.Where(p => p.ProjectManagerId == userId);

        var projects = await query.Select(p => new { p.Id, p.Name, p.TargetEndDate }).ToListAsync();
        var projectIds = projects.Select(p => p.Id).ToList();

        var firstFullProgressAt = await db.ProjectProgressUpdates
            .Where(u => projectIds.Contains(u.ProjectId) && u.Progress >= 100)
            .GroupBy(u => u.ProjectId)
            .Select(g => new { ProjectId = g.Key, At = g.Min(u => u.CreatedAt) })
            .ToDictionaryAsync(x => x.ProjectId, x => x.At);

        return projects.ToDictionary(
            p => p.Id,
            p =>
            {
                DateTime? fullAt = firstFullProgressAt.TryGetValue(p.Id, out var at) ? at : null;
                return new CompletedProject(p.Name,
                    CompletedProjectDemandRules.ResolveCompletionDate(fullAt, p.TargetEndDate),
                    IsBackfilled: fullAt is null);
            });
    }

    // Shared core of every Forecasting-chart endpoint below: every BOQItem of
    // a completed project, reduced to its final Actual Usage and placed in
    // its project's completion month — never the month an individual
    // Excess/Waste record happened to be logged in, so a project's whole,
    // final figure lands once, in the same month as its AI Predicted figure.
    //  - Lines with Excess/Waste records: Baseline - Excess - Waste, via
    //    ActualUsageCalculator. Items failing validation (Excess+Waste >
    //    baseline) are returned separately, never silently included or clamped.
    //  - Lines without any record: BOQItem.ActualQuantity as-is — either the
    //    Actual Qty typed in for a backfilled project, or the estimate
    //    ProjectService stood in at completion because nothing was logged.
    //    A line still at 0 (e.g. a backfilled row with no Actual Qty typed)
    //    is "no data", not zero demand, and is skipped.
    private async Task<(List<ReconciledBoqItem> Valid, List<FlaggedExcessItemDto> Flagged)> GetReconciledBoqItemsAsync(
        IReadOnlyDictionary<int, CompletedProject> completed, int? materialId, string? unit)
    {
        var projectIds = completed.Keys.ToList();

        var itemsQuery = db.BOQItems
            .Include(b => b.Material)
            .Where(b => projectIds.Contains(b.ProjectId));
        var recordsQuery = db.ExcessWasteRecords
            .Where(e => e.BOQItemId != null && projectIds.Contains(e.BOQItem!.ProjectId));
        if (materialId.HasValue)
        {
            itemsQuery = itemsQuery.Where(b => b.MaterialId == materialId.Value);
            recordsQuery = recordsQuery.Where(e => e.BOQItem!.MaterialId == materialId.Value);
        }

        var items = await itemsQuery.ToListAsync();
        var recordsByItem = (await recordsQuery
                .Select(e => new { BOQItemId = e.BOQItemId!.Value, e.Quantity, e.IsReusable })
                .ToListAsync())
            .ToLookup(e => e.BOQItemId);

        var valid = new List<ReconciledBoqItem>();
        var flagged = new List<FlaggedExcessItemDto>();

        foreach (var boqItem in items)
        {
            var project = completed[boqItem.ProjectId];

            // The baseline a record's Quantity is actually denominated in —
            // the same precedence BOQItem.ActualQuantity already uses as
            // ground truth — labelled with the unit THAT quantity is in:
            // the purchase unit when the purchase-unit baseline is the one
            // used, otherwise the BOQ row's own unit, never the catalog
            // Material's default unit (which can differ — a row of blocks
            // estimated in pcs against a catalog entry in sq.m). Same row-
            // unit-first rule the ML service forecasts in, so a line's
            // Actual Usage and its forecast always land on the same unit.
            var baseline = boqItem.EstimatedPurchaseQuantity ?? boqItem.EstimatedQuantity;
            var effectiveUnit = CompletedProjectDemandRules.ResolveBoqLineUnit(
                boqItem.EstimatedPurchaseQuantity.HasValue ? boqItem.EstimatedPurchaseUnit : null,
                boqItem.Unit, boqItem.Material.Unit);
            if (unit is not null && CompletedProjectDemandRules.NormalizeUnit(effectiveUnit) != CompletedProjectDemandRules.NormalizeUnit(unit))
                continue;

            var records = recordsByItem[boqItem.Id].ToList();
            decimal excessTotal = 0, wasteTotal = 0, actualUsage;

            if (records.Count > 0)
            {
                excessTotal = records.Where(e => e.IsReusable).Sum(e => e.Quantity);
                wasteTotal  = records.Where(e => !e.IsReusable).Sum(e => e.Quantity);

                var result = ActualUsageCalculator.Calculate(baseline, excessTotal, wasteTotal);
                if (!result.IsValid)
                {
                    flagged.Add(new FlaggedExcessItemDto
                    {
                        BOQItemId = boqItem.Id, ProjectId = boqItem.ProjectId, ProjectName = project.Name,
                        MaterialName = boqItem.Material.Name, Unit = effectiveUnit,
                        EstimatedQuantity = baseline, ExcessTotal = excessTotal, WasteTotal = wasteTotal,
                        Reason = result.ErrorMessage!,
                    });
                    continue;
                }
                actualUsage = result.ActualUsage!.Value;
            }
            else
            {
                if (boqItem.ActualQuantity <= 0) continue;
                actualUsage = boqItem.ActualQuantity;
            }

            valid.Add(new ReconciledBoqItem(
                boqItem.Id, boqItem.ProjectId, project.Name,
                boqItem.MaterialId, boqItem.Material.Name, effectiveUnit,
                CompletedProjectDemandRules.ToMonth(project.CompletedAt),
                baseline, excessTotal, wasteTotal, actualUsage));
        }

        return (valid, flagged);
    }

    // Real AI model output only — ForecastedMaterial.ForecastedQuantity from
    // ForecastResult, never EstimatedPurchaseQuantity (which is user/BOQ-scan
    // entered, at best auto-suggested from a historical-average heuristic;
    // see GetHistoricalEstimateAsync — it has never been touched by the ML
    // pipeline). Only for the same completed projects the Actual Usage side
    // covers, placed in each project's completion month — so each month's AI
    // Predicted figure always comes from the same projects as its Actual
    // Usage, never from unrelated projects that merely ran a forecast that
    // month. Which forecasts count depends on how the project got here:
    //  - Finished in the app: the original forecast, made BEFORE it finished
    //    (CompletedProjectDemandRules.SelectForecastRuns).
    //  - Backfilled: the model's evaluation on that project, any run date
    //    (CompletedProjectDemandRules.SelectHistoricalForecastRows).
    private async Task<Dictionary<(int MaterialId, string Unit, DateTime Month), PredictedTotal>> GetMonthlyPredictedTotalsAsync(
        IReadOnlyDictionary<int, CompletedProject> completed, int? materialId, string? unit)
    {
        var projectIds = completed.Keys.ToList();

        var runs = await db.ForecastResults
            .Where(f => projectIds.Contains(f.ProjectId))
            .Select(f => new { f.Id, f.ProjectId, f.PhaseId, f.GeneratedAt, IsSeeded = f.Notes == DbInitializer.ForecastSeedMarker })
            .ToListAsync();
        var runById = runs.ToDictionary(r => r.Id);

        var liveRunIds = runs
            .Where(r => !completed[r.ProjectId].IsBackfilled)
            .GroupBy(r => r.ProjectId)
            .SelectMany(g => CompletedProjectDemandRules.SelectForecastRuns(
                g.Select(r => new CompletedProjectDemandRules.ForecastRun(r.Id, r.PhaseId, r.GeneratedAt)),
                completed[g.Key].CompletedAt))
            .ToHashSet();
        var runIds = runs
            .Where(r => completed[r.ProjectId].IsBackfilled || liveRunIds.Contains(r.Id))
            .Select(r => r.Id)
            .ToList();

        var rowsQuery = db.ForecastedMaterials.Where(fm => runIds.Contains(fm.ForecastResultId));
        if (materialId.HasValue)
            rowsQuery = rowsQuery.Where(fm => fm.MaterialId == materialId.Value);

        var rows = await rowsQuery
            .Select(fm => new { fm.ForecastResultId, fm.MaterialId, fm.Unit, MaterialName = fm.Material.Name, MaterialUnit = fm.Material.Unit, fm.ForecastedQuantity })
            .ToListAsync();
        var materialNames = rows.GroupBy(r => r.MaterialId).ToDictionary(g => g.Key, g => g.First().MaterialName);

        // A forecast row with no unit of its own (DbInitializer's seeded
        // rows never set one) was made from that project's BOQ line for the
        // material, so it's in that line's unit — taken from the project's
        // own BOQ lines when they all agree on one, else the catalog
        // Material's unit.
        var unitlessKeys = rows.Where(r => string.IsNullOrWhiteSpace(r.Unit))
            .Select(r => (runById[r.ForecastResultId].ProjectId, r.MaterialId))
            .ToHashSet();
        var lineUnitByProjectMaterial = new Dictionary<(int ProjectId, int MaterialId), string>();
        if (unitlessKeys.Count > 0)
        {
            var unitlessProjectIds = unitlessKeys.Select(k => k.ProjectId).Distinct().ToList();
            var unitlessMaterialIds = unitlessKeys.Select(k => k.MaterialId).Distinct().ToList();
            var lines = await db.BOQItems
                .Where(b => unitlessProjectIds.Contains(b.ProjectId) && unitlessMaterialIds.Contains(b.MaterialId))
                .Select(b => new { b.ProjectId, b.MaterialId, b.EstimatedPurchaseQuantity, b.EstimatedPurchaseUnit, b.Unit, MaterialUnit = b.Material.Unit })
                .ToListAsync();
            foreach (var g in lines.GroupBy(b => (b.ProjectId, b.MaterialId)))
            {
                var lineUnits = g
                    .Select(b => CompletedProjectDemandRules.ResolveBoqLineUnit(
                        b.EstimatedPurchaseQuantity.HasValue ? b.EstimatedPurchaseUnit : null, b.Unit, b.MaterialUnit))
                    .GroupBy(CompletedProjectDemandRules.NormalizeUnit)
                    .ToList();
                if (lineUnits.Count == 1)
                    lineUnitByProjectMaterial[g.Key] = lineUnits[0].First();
            }
        }

        string RowUnit(int projectId, int materialId, string? rowUnit, string materialUnit) =>
            !string.IsNullOrWhiteSpace(rowUnit) ? rowUnit.Trim()
            : lineUnitByProjectMaterial.GetValueOrDefault((projectId, materialId), materialUnit);

        var candidates = rows
            .Select(r => (ProjectId: runById[r.ForecastResultId].ProjectId, Row: new CompletedProjectDemandRules.ForecastRow(
                r.ForecastResultId, runById[r.ForecastResultId].GeneratedAt, runById[r.ForecastResultId].IsSeeded,
                r.MaterialId, RowUnit(runById[r.ForecastResultId].ProjectId, r.MaterialId, r.Unit, r.MaterialUnit), r.ForecastedQuantity)))
            .Where(c => unit is null || CompletedProjectDemandRules.NormalizeUnit(c.Row.Unit) == CompletedProjectDemandRules.NormalizeUnit(unit))
            .ToList();

        var selected = candidates
            .GroupBy(c => c.ProjectId)
            .SelectMany(g => completed[g.Key].IsBackfilled
                ? CompletedProjectDemandRules.SelectHistoricalForecastRows(g.Select(c => c.Row)).Select(row => (ProjectId: g.Key, Row: row))
                : g.AsEnumerable());

        var totals = new Dictionary<(int MaterialId, string Unit, DateTime Month), PredictedTotal>();
        foreach (var (projectId, row) in selected)
        {
            var key = (row.MaterialId, CompletedProjectDemandRules.NormalizeUnit(row.Unit),
                CompletedProjectDemandRules.ToMonth(completed[projectId].CompletedAt));
            if (!totals.TryGetValue(key, out var total))
                totals[key] = total = new PredictedTotal { MaterialName = materialNames[row.MaterialId], Unit = row.Unit };
            total.Quantity += row.Quantity;
            total.ProjectIds.Add(projectId);
        }
        return totals;
    }

    // Drives the Forecasting page's chart for one selected material+unit (or
    // every material if none is selected), completed projects only. Actual
    // Usage is a monthly TOTAL (sum, not average) of every completed
    // project's BOQ lines whose completion month falls in that bucket; AI
    // Predicted is the monthly total of those same projects' forecasts for
    // the same material+unit (see GetMonthlyPredictedTotalsAsync for which
    // forecasts count). Either side is null — never
    // zero — when nothing that month has that figure.
    public async Task<IEnumerable<MonthlyDemandSummaryDto>> GetMonthlyDemandSummaryAsync(int userId, string role, int? materialId, string? unit)
    {
        var completed = await GetCompletedProjectsAsync(userId, role);
        var (valid, _) = await GetReconciledBoqItemsAsync(completed, materialId, unit);
        var predicted = await GetMonthlyPredictedTotalsAsync(completed, materialId, unit);

        var actualByKey = valid
            .GroupBy(r => (r.MaterialId, Unit: CompletedProjectDemandRules.NormalizeUnit(r.Unit), Month: r.ReportingMonth))
            .ToDictionary(g => g.Key, g => g.ToList());

        var keys = actualByKey.Keys.Concat(predicted.Keys).Distinct().OrderBy(k => k.Month).ThenBy(k => k.MaterialId);

        return keys.Select(key =>
        {
            var items = actualByKey.GetValueOrDefault(key);
            var p = predicted.GetValueOrDefault(key);
            var projectNames = (items?.Select(i => i.ProjectId) ?? [])
                .Concat(p?.ProjectIds ?? [])
                .Distinct()
                .Select(id => completed[id].Name)
                .OrderBy(n => n)
                .ToList();
            return new MonthlyDemandSummaryDto
            {
                Month       = key.Month.ToString("yyyy-MM"),
                MonthLabel  = key.Month.ToString("MMMM yyyy"),
                MaterialId  = key.MaterialId,
                MaterialName = items?.FirstOrDefault()?.MaterialName ?? p?.MaterialName ?? string.Empty,
                Unit        = items?.FirstOrDefault()?.Unit ?? p?.Unit ?? key.Unit,
                ActualUsage = items is null ? null : Math.Round(items.Sum(i => i.ActualUsage), 2),
                AiPredicted = p is null ? null : Math.Round(p.Quantity, 2),
                ProjectCount = projectNames.Count,
                ContributingProjects = projectNames,
                EstimatedTotal = items is null ? null : items.Sum(i => i.EstimatedQuantity),
                ExcessTotal    = items is null ? null : items.Sum(i => i.ExcessTotal),
                WasteTotal     = items is null ? null : items.Sum(i => i.WasteTotal),
            };
        });
    }

    public async Task<IEnumerable<MaterialOptionDto>> GetMaterialOptionsAsync(int userId, string role)
    {
        var completed = await GetCompletedProjectsAsync(userId, role);
        var (valid, _) = await GetReconciledBoqItemsAsync(completed, null, null);
        // Grouped on the folded unit (same as the chart's own series), so
        // "pcs"/"PC " never show up as two separate dropdown entries.
        return valid
            .GroupBy(r => (r.MaterialId, Unit: CompletedProjectDemandRules.NormalizeUnit(r.Unit)))
            .Select(g => new MaterialOptionDto
            {
                MaterialId = g.Key.MaterialId,
                MaterialName = g.First().MaterialName,
                Unit = g.First().Unit,
                TotalHistoricalDemand = g.Sum(r => r.ActualUsage),
            })
            .OrderByDescending(m => m.TotalHistoricalDemand)
            .ThenBy(m => m.MaterialName);
    }

    public async Task<IEnumerable<FlaggedExcessItemDto>> GetFlaggedExcessItemsAsync(int userId, string role)
    {
        var completed = await GetCompletedProjectsAsync(userId, role);
        var (_, flagged) = await GetReconciledBoqItemsAsync(completed, null, null);
        return flagged;
    }
}
