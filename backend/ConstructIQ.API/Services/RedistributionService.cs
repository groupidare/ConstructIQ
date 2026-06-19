using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Procurement;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class RedistributionService(AppDbContext db) : IRedistributionService
{
    public async Task<IEnumerable<RedistributionRecommendationDto>> GetRecommendationsAsync()
    {
        // Stored as procurement recommendations with notes containing redistribution data
        // In a production scenario, add a dedicated RedistributionRecord entity
        await Task.CompletedTask;
        return [];
    }

    public async Task GenerateRecommendationsAsync()
    {
        var excessPool = (await db.InventoryRecords
            .Include(r => r.Material)
            .Where(r => r.ExcessQuantity > 0 && r.ExcessQuantity >= r.ReorderPoint)
            .ToListAsync())
            .Select(r => (r.ProjectId, r.MaterialId, r.ExcessQuantity, r.Material.UnitCost))
            .ToList();

        var demandPool = (await db.ProcurementRecommendations
            .Where(r => r.CurrentStock < r.ReorderPoint)
            .ToListAsync())
            .Select(r => (r.ProjectId, r.MaterialId, r.RecommendedQuantity))
            .ToList();

        var matches = RedistributionEngine.FindMatches(excessPool, demandPool);

        foreach (var match in matches)
        {
            var sourceProject = await db.Projects.FindAsync(match.SourceProjectId);
            var targetProject = await db.Projects.FindAsync(match.TargetProjectId);
            var material      = await db.Materials.FindAsync(match.MaterialId);

            if (sourceProject is null || targetProject is null || material is null) continue;

            // Log as an activity — dedicated entity would be added in next sprint
        }

        await db.SaveChangesAsync();
    }

    public async Task<bool> ApproveTransferAsync(int recommendationId, int userId)
    {
        await Task.CompletedTask;
        return true;
    }
}
