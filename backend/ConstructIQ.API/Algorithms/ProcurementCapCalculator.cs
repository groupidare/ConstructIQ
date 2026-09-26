using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Algorithms;

/// <summary>
/// Shared quantity-cap math for Notify Procurement/Warehouse and the BOQ
/// bulk-save backstop: a project can never be asked to buy more of a
/// material than its BOQ estimate, minus whatever's already covered —
/// redistributed in, released from the warehouse, or already asked of
/// Procurement. Each source is tracked from its own real table (not the
/// generic BOQItem.RequestedQuantity ask-counter), because "asked" and
/// "actually covered" can differ — e.g. a warehouse request for 12 approved
/// for only 3 (that's all that was on hand) only reduces the gap by 3, not 12.
/// </summary>
public static class ProcurementCapCalculator
{
    // Approved is the terminal state for a redistribution transfer (no
    // InTransit/Completed step in this app) — see RedistributionStatuses.
    public static async Task<decimal> GetRedistributedQuantityAsync(AppDbContext db, int projectId, int materialId) =>
        await db.RedistributionRequests
            .Where(r => r.TargetProjectId == projectId && r.MaterialId == materialId && r.Status == RedistributionStatus.Approved)
            .SumAsync(r => (decimal?)r.Quantity) ?? 0;

    // Nothing is actually released from the warehouse until a request is
    // Approved — a Pending ask doesn't count here (it can't be re-requested
    // anyway; WarehouseRequestService.CreateAsync blocks a second Pending
    // request for the same material while one is still outstanding).
    private static async Task<decimal> GetWarehouseAccountedQuantityAsync(AppDbContext db, int projectId, int materialId) =>
        await db.WarehouseRequests
            .Where(w => w.ProjectId == projectId && w.MaterialId == materialId && w.Status == WarehouseRequestStatus.Approved)
            .SumAsync(w => (decimal?)(w.ApprovedQuantity ?? w.RequestedQuantity)) ?? 0;

    // Every Procurement ask counts as spoken-for, whether or not it's been
    // turned into a Purchase Order yet.
    private static async Task<decimal> GetProcurementRequestedQuantityAsync(AppDbContext db, int projectId, int materialId) =>
        await db.MaterialRequests
            .Where(m => m.ProjectId == projectId && m.MaterialId == materialId)
            .SumAsync(m => (decimal?)m.Quantity) ?? 0;

    // Remaining requestable quantity, aggregated across every BOQ row for
    // this (project, material) pair — a material can appear on more than
    // one BOQ row.
    public static async Task<decimal> GetRemainingRequestableAsync(AppDbContext db, int projectId, int materialId)
    {
        var estimatedTotal = await db.BOQItems
            .Where(b => b.ProjectId == projectId && b.MaterialId == materialId)
            .SumAsync(b => (decimal?)(b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity)) ?? 0;

        var redistributed = await GetRedistributedQuantityAsync(db, projectId, materialId);
        var warehouse      = await GetWarehouseAccountedQuantityAsync(db, projectId, materialId);
        var procurement    = await GetProcurementRequestedQuantityAsync(db, projectId, materialId);

        return Math.Max(0, estimatedTotal - redistributed - warehouse - procurement);
    }

    // Same calculation as above, batched across every material in a
    // project's BOQ in one pass — used to give the Material Plan tab a live,
    // authoritative "remaining" figure per row without an N+1 round trip.
    public static async Task<Dictionary<int, decimal>> GetRemainingRequestableForProjectAsync(AppDbContext db, int projectId)
    {
        var boqRows = await db.BOQItems.Where(b => b.ProjectId == projectId).ToListAsync();
        var materialIds = boqRows.Select(b => b.MaterialId).Distinct().ToList();
        if (materialIds.Count == 0) return [];

        var estimatedByMaterial = boqRows
            .GroupBy(b => b.MaterialId)
            .ToDictionary(g => g.Key, g => g.Sum(b => b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity));

        var redistributedByMaterial = (await db.RedistributionRequests
                .Where(r => r.TargetProjectId == projectId && materialIds.Contains(r.MaterialId) && r.Status == RedistributionStatus.Approved)
                .ToListAsync())
            .GroupBy(r => r.MaterialId)
            .ToDictionary(g => g.Key, g => g.Sum(r => r.Quantity));

        var warehouseByMaterial = (await db.WarehouseRequests
                .Where(w => w.ProjectId == projectId && materialIds.Contains(w.MaterialId) && w.Status == WarehouseRequestStatus.Approved)
                .ToListAsync())
            .GroupBy(w => w.MaterialId)
            .ToDictionary(g => g.Key, g => g.Sum(w => w.ApprovedQuantity ?? w.RequestedQuantity));

        var procurementByMaterial = (await db.MaterialRequests
                .Where(m => m.ProjectId == projectId && materialIds.Contains(m.MaterialId))
                .ToListAsync())
            .GroupBy(m => m.MaterialId)
            .ToDictionary(g => g.Key, g => g.Sum(m => m.Quantity));

        return materialIds.ToDictionary(
            id => id,
            id => Math.Max(0,
                estimatedByMaterial.GetValueOrDefault(id)
                - redistributedByMaterial.GetValueOrDefault(id)
                - warehouseByMaterial.GetValueOrDefault(id)
                - procurementByMaterial.GetValueOrDefault(id)));
    }
}
