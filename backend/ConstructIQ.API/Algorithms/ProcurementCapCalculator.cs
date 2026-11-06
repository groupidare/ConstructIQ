using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Algorithms;

/// <summary>
/// Shared quantity math for Notify Procurement/Warehouse: how much a BOQ row
/// still needs, minus whatever's already covered — redistributed in, released
/// from the warehouse, or already asked of Procurement. Both only use it to
/// suggest a quantity and to flag a request beyond it as an additional order.
/// Each source is tracked from its own real table (not the generic
/// BOQItem.RequestedQuantity ask-counter), because "asked" and "actually
/// covered" can differ — e.g. a warehouse request for 12 approved for only 3
/// (that's all that was on hand) only reduces the gap by 3, not 12.
///
/// Per row, not per material: saving can merge different rows into one catalog
/// Material (THHN wire in rolls and PVC conduit in pieces), so a material-wide
/// total would add unlike units and let one row's request complete another.
/// A request knows its row. What doesn't — a redistribution transfer, or a
/// request or PO line made before rows were tracked — only counts when the
/// material has a single row, the usual case. With several it can't say which
/// it was for, and guessing would mark a row covered that nobody asked for
/// (12 l.m of transferred wire completing a 3-roll row). So it counts for none:
/// a row showing a need it may not have is visible; one hiding a need isn't.
/// </summary>
public static class ProcurementCapCalculator
{
    // NetLeftToOrder only counts a source once it's actually been approved: an
    // approved transfer, a warehouse request approved for what was really
    // released, or a purchase order past Pending. RemainingRequestable also
    // counts every Procurement ask, so a second request can't double the ask
    // before the first has become a PO. WarehouseApproved: the warehouse has
    // approved a check for this row at all — what unlocks Procurement when the
    // warehouse has stock.
    // WarehousePendingQuantity: asked of the warehouse, not yet answered.
    // ApprovedQuantity/AskedQuantity: what the two figures above were reduced by.
    // A row with no purchase estimate yet has only its BOQ measure to go on, so
    // the Material Plan works out what's left from these and the quantity on
    // screen, not from those figures.
    // WarehouseRejected: the warehouse turned a check for this row down, which
    // answers it just as an approval does: Procurement is what's left.
    public sealed record RowStatus(decimal NetLeftToOrder, decimal RemainingRequestable, bool WarehouseApproved, decimal WarehousePendingQuantity = 0, decimal ApprovedQuantity = 0, decimal AskedQuantity = 0, bool WarehouseRejected = false);

    public sealed record RowNeed(int RowId, int MaterialId, decimal Estimate);

    // Pure so which coverage reaches which row can be tested.
    public static Dictionary<int, decimal> LeftPerRow(
        IReadOnlyCollection<RowNeed> rows, IReadOnlyDictionary<int, decimal> coveredByRow, IReadOnlyDictionary<int, decimal> coveredByMaterial)
    {
        var covered = CoveredPerRow(rows, coveredByRow, coveredByMaterial);
        return rows.ToDictionary(row => row.RowId, row => Math.Max(0, row.Estimate - covered[row.RowId]));
    }

    private static Dictionary<int, decimal> CoveredPerRow(
        IReadOnlyCollection<RowNeed> rows, IReadOnlyDictionary<int, decimal> coveredByRow, IReadOnlyDictionary<int, decimal> coveredByMaterial)
    {
        var rowsPerMaterial = rows.GroupBy(r => r.MaterialId).ToDictionary(g => g.Key, g => g.Count());
        return rows.ToDictionary(row => row.RowId, row =>
            coveredByRow.GetValueOrDefault(row.RowId)
            + (rowsPerMaterial[row.MaterialId] == 1 ? coveredByMaterial.GetValueOrDefault(row.MaterialId) : 0));
    }

    private static void Add(Dictionary<int, decimal> totals, int key, decimal quantity) =>
        totals[key] = totals.GetValueOrDefault(key) + quantity;

    public static async Task<Dictionary<int, RowStatus>> GetRowStatusesAsync(AppDbContext db, int projectId)
    {
        var rows = await db.BOQItems
            .Where(b => b.ProjectId == projectId)
            .OrderBy(b => b.Id)
            .Select(b => new RowNeed(b.Id, b.MaterialId, b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity))
            .ToListAsync();
        if (rows.Count == 0) return [];

        var rowIds = rows.Select(r => r.RowId).ToHashSet();

        // Transfers name a material, never a row.
        var redistributed = await db.RedistributionRequests
            .Where(r => r.TargetProjectId == projectId && r.Status == RedistributionStatus.Approved)
            .Select(r => new { r.MaterialId, r.Quantity })
            .ToListAsync();

        var warehouse = await db.WarehouseRequests
            .Where(w => w.ProjectId == projectId && w.Status == WarehouseRequestStatus.Approved)
            .Select(w => new { w.BOQItemId, w.MaterialId, Quantity = w.ApprovedQuantity ?? w.RequestedQuantity })
            .ToListAsync();

        var pendingChecks = await db.WarehouseRequests
            .Where(w => w.ProjectId == projectId && w.Status == WarehouseRequestStatus.Pending && w.BOQItemId != null)
            .Select(w => new { BOQItemId = w.BOQItemId!.Value, w.RequestedQuantity })
            .ToListAsync();
        var pendingByRow = pendingChecks.GroupBy(w => w.BOQItemId).ToDictionary(g => g.Key, g => g.Sum(w => w.RequestedQuantity));

        var rejectedRows = (await db.WarehouseRequests
            .Where(w => w.ProjectId == projectId && w.Status == WarehouseRequestStatus.Rejected && w.BOQItemId != null)
            .Select(w => w.BOQItemId!.Value)
            .ToListAsync()).ToHashSet();

        var requests = await db.MaterialRequests
            .Where(m => m.ProjectId == projectId && !m.IsPriceInquiry) // a price check isn't asking for material
            .OrderBy(m => m.Id)
            .Select(m => new { m.BOQItemId, m.MaterialId, m.Quantity, m.FulfilledByPurchaseOrderId })
            .ToListAsync();

        var poLines = await db.PurchaseOrderMaterials
            .Where(m => m.MaterialId != null && m.PurchaseOrder.ProjectId == projectId && m.PurchaseOrder.Status != PurchaseOrderStatus.Pending)
            .OrderBy(m => m.Id)
            .Select(m => new { m.PurchaseOrderId, MaterialId = m.MaterialId!.Value, m.BOQItemId, m.Quantity })
            .ToListAsync();

        var approvedByRow = new Dictionary<int, decimal>();
        var approvedByMaterial = new Dictionary<int, decimal>();
        var askedByRow = new Dictionary<int, decimal>();
        var askedByMaterial = new Dictionary<int, decimal>();

        void AddSource(Dictionary<int, decimal> byRow, Dictionary<int, decimal> byMaterial, int? rowId, int materialId, decimal quantity)
        {
            if (rowId is { } id && rowIds.Contains(id)) Add(byRow, id, quantity);
            else Add(byMaterial, materialId, quantity);
        }

        foreach (var t in redistributed)
        {
            Add(approvedByMaterial, t.MaterialId, t.Quantity);
            Add(askedByMaterial, t.MaterialId, t.Quantity);
        }
        foreach (var w in warehouse)
        {
            AddSource(approvedByRow, approvedByMaterial, w.BOQItemId, w.MaterialId, w.Quantity);
            AddSource(askedByRow, askedByMaterial, w.BOQItemId, w.MaterialId, w.Quantity);
        }
        foreach (var m in requests)
            AddSource(askedByRow, askedByMaterial, m.BOQItemId, m.MaterialId, m.Quantity);

        // A generated PO line isn't linked to a BOQ row — that link is left for
        // a person to make, since it feeds the forecasting model. The request it
        // fulfils still says which row it was for.
        var uncounted = requests
            .Where(m => m.BOQItemId != null && m.FulfilledByPurchaseOrderId != null)
            .Select(m => new FulfilledRequest(m.FulfilledByPurchaseOrderId!.Value, m.MaterialId, m.BOQItemId!.Value, m.Quantity))
            .ToList();
        foreach (var line in poLines)
        {
            if (line.BOQItemId is not null)
            {
                AddSource(approvedByRow, approvedByMaterial, line.BOQItemId, line.MaterialId, line.Quantity);
                continue;
            }
            var quantity = line.Quantity;
            for (var i = 0; i < uncounted.Count && quantity > 0; i++)
            {
                var request = uncounted[i];
                if (request.PurchaseOrderId != line.PurchaseOrderId || request.MaterialId != line.MaterialId || request.Quantity <= 0) continue;
                var taken = Math.Min(quantity, request.Quantity);
                AddSource(approvedByRow, approvedByMaterial, request.RowId, line.MaterialId, taken);
                uncounted[i] = request with { Quantity = request.Quantity - taken };
                quantity -= taken;
            }
            if (quantity > 0) Add(approvedByMaterial, line.MaterialId, quantity);
        }

        var netLeft = LeftPerRow(rows, approvedByRow, approvedByMaterial);
        var remaining = LeftPerRow(rows, askedByRow, askedByMaterial);
        var approvedQuantities = CoveredPerRow(rows, approvedByRow, approvedByMaterial);
        var askedQuantities = CoveredPerRow(rows, askedByRow, askedByMaterial);

        var approvedRows = warehouse.Where(w => w.BOQItemId != null).Select(w => w.BOQItemId!.Value).ToHashSet();
        // A check with no row can only unlock a material's one row, same as above.
        var singleRowMaterials = rows.GroupBy(r => r.MaterialId).Where(g => g.Count() == 1).Select(g => g.Key).ToHashSet();
        var approvedMaterials = warehouse
            .Where(w => (w.BOQItemId == null || !rowIds.Contains(w.BOQItemId.Value)) && singleRowMaterials.Contains(w.MaterialId))
            .Select(w => w.MaterialId)
            .ToHashSet();

        return rows.ToDictionary(r => r.RowId, r => new RowStatus(
            netLeft[r.RowId], remaining[r.RowId],
            approvedRows.Contains(r.RowId) || approvedMaterials.Contains(r.MaterialId),
            pendingByRow.GetValueOrDefault(r.RowId),
            approvedQuantities[r.RowId], askedQuantities[r.RowId],
            rejectedRows.Contains(r.RowId)));
    }

    private sealed record FulfilledRequest(int PurchaseOrderId, int MaterialId, int RowId, decimal Quantity);

    // The row a new request is for must really be this project's row of this
    // material; no row means the material as a whole.
    public static async Task<BOQItem?> FindRequestRowAsync(AppDbContext db, int? boqItemId, int projectId, int materialId)
    {
        if (boqItemId is null) return null;
        return await db.BOQItems.FirstOrDefaultAsync(b => b.Id == boqItemId && b.ProjectId == projectId && b.MaterialId == materialId)
            ?? throw new InvalidOperationException("That Bill of Quantities row doesn't belong to this project and material. Reopen the Material Plan and try again.");
    }

    // A row can't be requested until it says how much and in what. Price checks
    // go through their own path and aren't held to this: they exist for
    // materials still being priced.
    public static void EnsureRowIsFilledIn(BOQItem? row)
    {
        if (row is null) return;
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(row.Unit)) missing.Add("Area Unit");
        if (string.IsNullOrWhiteSpace(row.EstimatedPurchaseUnit)) missing.Add("Material Unit");
        if ((row.EstimatedPurchaseQuantity ?? 0) <= 0) missing.Add("Material Quantity");
        if (missing.Count > 0)
            throw new InvalidOperationException($"Fill in the {string.Join(", ", missing)} on this row before requesting it.");
    }

    // Requesting a whole plan at once needs all of it filled in. Why it can't go
    // yet, or null if it can.
    public static async Task<string?> GetBulkRequestProblemAsync(AppDbContext db, int projectId)
    {
        var rows = await db.BOQItems
            .Where(b => b.ProjectId == projectId)
            .Select(b => new { b.Unit, b.EstimatedPurchaseUnit, b.EstimatedPurchaseQuantity })
            .ToListAsync();
        var blankAreaUnit = rows.Any(r => string.IsNullOrWhiteSpace(r.Unit));
        var blankMaterialUnit = rows.Any(r => string.IsNullOrWhiteSpace(r.EstimatedPurchaseUnit));
        var blankQuantity = rows.Any(r => (r.EstimatedPurchaseQuantity ?? 0) <= 0);
        var incomplete = rows.Count(r => string.IsNullOrWhiteSpace(r.Unit) || string.IsNullOrWhiteSpace(r.EstimatedPurchaseUnit) || (r.EstimatedPurchaseQuantity ?? 0) <= 0);
        if (incomplete == 0) return null;

        var fields = new[] { blankAreaUnit ? "Area Unit" : null, blankMaterialUnit ? "Material Unit" : null, blankQuantity ? "Material Quantity" : null }
            .Where(f => f is not null);
        return $"{incomplete} material{(incomplete == 1 ? " is" : "s are")} missing a {string.Join(", ", fields)} in this Material Plan. Fill in all of them before requesting.";
    }

    // How much more a new request can ask for before it's an additional one.
    public static async Task<decimal> GetRemainingRequestableAsync(AppDbContext db, int projectId, int materialId, int? boqItemId = null)
    {
        var statuses = await GetRowStatusesAsync(db, projectId);
        if (boqItemId is { } id && statuses.TryGetValue(id, out var row)) return row.RemainingRequestable;

        var materialRows = await db.BOQItems
            .Where(b => b.ProjectId == projectId && b.MaterialId == materialId)
            .Select(b => b.Id)
            .ToListAsync();
        return materialRows.Sum(r => statuses.GetValueOrDefault(r)?.RemainingRequestable ?? 0);
    }

    // Per material, for callers that don't deal in rows.
    public static async Task<Dictionary<int, decimal>> GetRemainingRequestableForProjectAsync(AppDbContext db, int projectId)
    {
        var statuses = await GetRowStatusesAsync(db, projectId);
        var rows = await db.BOQItems
            .Where(b => b.ProjectId == projectId)
            .Select(b => new { b.Id, b.MaterialId })
            .ToListAsync();
        return rows
            .GroupBy(r => r.MaterialId)
            .ToDictionary(g => g.Key, g => g.Sum(r => statuses.GetValueOrDefault(r.Id)?.RemainingRequestable ?? 0));
    }

    // Approved is the terminal state for a redistribution transfer (no
    // InTransit/Completed step in this app) — see RedistributionStatuses.
    public static async Task<decimal> GetRedistributedQuantityAsync(AppDbContext db, int projectId, int materialId) =>
        await db.RedistributionRequests
            .Where(r => r.TargetProjectId == projectId && r.MaterialId == materialId && r.Status == RedistributionStatus.Approved)
            .SumAsync(r => (decimal?)r.Quantity) ?? 0;

    // Nothing is actually released from the warehouse until a request is
    // Approved — a Pending ask doesn't count here.
    private static async Task<decimal> GetWarehouseAccountedQuantityAsync(AppDbContext db, int projectId, int materialId) =>
        await db.WarehouseRequests
            .Where(w => w.ProjectId == projectId && w.MaterialId == materialId && w.Status == WarehouseRequestStatus.Approved)
            .SumAsync(w => (decimal?)(w.ApprovedQuantity ?? w.RequestedQuantity)) ?? 0;

    // Only Approved/DeliveryInProgress/Delivered purchase orders represent
    // material that's actually been committed to arriving — a Pending PO is
    // still just a draft and doesn't reduce what's left to order.
    private static async Task<decimal> GetApprovedPurchaseOrderQuantityAsync(AppDbContext db, int projectId, int materialId) =>
        await db.PurchaseOrderMaterials
            .Where(m => m.MaterialId == materialId
                && m.PurchaseOrder.ProjectId == projectId
                && m.PurchaseOrder.Status != PurchaseOrderStatus.Pending)
            .SumAsync(m => (decimal?)m.Quantity) ?? 0;

    // One material across its rows — used where a whole-material figure is what's
    // wanted (e.g. ranking redistribution target-project suggestions by real
    // outstanding need).
    public static async Task<decimal> GetNetLeftToOrderAsync(AppDbContext db, int projectId, int materialId)
    {
        var estimatedTotal = await db.BOQItems
            .Where(b => b.ProjectId == projectId && b.MaterialId == materialId)
            .SumAsync(b => (decimal?)(b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity)) ?? 0;

        var redistributed = await GetRedistributedQuantityAsync(db, projectId, materialId);
        var warehouse      = await GetWarehouseAccountedQuantityAsync(db, projectId, materialId);
        var purchaseOrders = await GetApprovedPurchaseOrderQuantityAsync(db, projectId, materialId);

        return Math.Max(0, estimatedTotal - redistributed - warehouse - purchaseOrders);
    }
}
