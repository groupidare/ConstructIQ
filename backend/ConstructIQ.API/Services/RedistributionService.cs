using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Procurement;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class RedistributionService(AppDbContext db) : IRedistributionService
{
    // Requests still "in play" — not yet completed or rejected.
    private static readonly RedistributionStatus[] ActiveStatuses =
    [
        RedistributionStatus.AiSuggested,
        RedistributionStatus.PendingApproval,
        RedistributionStatus.Approved,
        RedistributionStatus.InTransit,
    ];

    // Damaged/expired stock isn't safe to redistribute — only unused/overordered excess is.
    private static readonly ExcessType[] ReusableExcessTypes = [ExcessType.Unused, ExcessType.Overordered];

    public async Task<IEnumerable<RedistributionRecommendationDto>> GetRecommendationsAsync()
    {
        var requests = await db.RedistributionRequests
            .Include(r => r.Material)
            .Include(r => r.SourceProject)
            .Include(r => r.TargetProject)
            .Where(r => ActiveStatuses.Contains(r.Status))
            .OrderByDescending(r => r.RequestedAt)
            .ToListAsync();

        return requests.Select(ToDto);
    }

    public async Task GenerateRecommendationsAsync()
    {
        // Supply signal 1: current project-level excess inventory.
        var inventoryExcess = await db.InventoryRecords
            .Include(r => r.Material)
            .Where(r => r.ExcessQuantity > 0)
            .Select(r => new { r.ProjectId, r.MaterialId, Qty = r.ExcessQuantity, UnitCost = r.Material.UnitCost })
            .ToListAsync();

        // Supply signal 2: the excess/waste logs — only entries marked reusable and not damaged/expired.
        var loggedExcess = await db.ExcessWasteRecords
            .Where(r => r.IsReusable && ReusableExcessTypes.Contains(r.ExcessType))
            .Select(r => new { r.ProjectId, r.MaterialId, Qty = r.Quantity, r.UnitCost })
            .ToListAsync();

        var excessPool = inventoryExcess
            .Concat(loggedExcess)
            .GroupBy(x => (x.ProjectId, x.MaterialId))
            .Select(g => (
                ProjectId: g.Key.ProjectId,
                MaterialId: g.Key.MaterialId,
                ExcessQty: g.Sum(x => x.Qty),
                // Use the most specific price available: an actual logged excess cost over the catalog price.
                UnitCost: g.Select(x => x.UnitCost).FirstOrDefault(c => c > 0)))
            .Where(x => x.ExcessQty > 0)
            .ToList();

        var demandRows = await db.ProcurementRecommendations
            .Where(r => r.CurrentStock < r.ReorderPoint)
            .Select(r => new { r.ProjectId, r.MaterialId, r.RecommendedQuantity, r.UrgencyLevel })
            .ToListAsync();

        var demandPool = demandRows
            .Select(r => (r.ProjectId, r.MaterialId, NeededQty: r.RecommendedQuantity))
            .ToList();

        var urgencyByProjectMaterial = demandRows
            .GroupBy(r => (r.ProjectId, r.MaterialId))
            .ToDictionary(g => g.Key, g => g.Max(r => r.UrgencyLevel));

        var matches = RedistributionEngine.FindMatches(excessPool, demandPool);

        var existingActiveKeys = (await db.RedistributionRequests
            .Where(r => ActiveStatuses.Contains(r.Status))
            .Select(r => new { r.MaterialId, r.SourceProjectId, r.TargetProjectId })
            .ToListAsync())
            .Select(r => (r.MaterialId, r.SourceProjectId, r.TargetProjectId))
            .ToHashSet();

        foreach (var match in matches)
        {
            var key = (match.MaterialId, match.SourceProjectId, match.TargetProjectId);
            if (existingActiveKeys.Contains(key)) continue;

            var sourceProject = await db.Projects.FindAsync(match.SourceProjectId);
            var targetProject = await db.Projects.FindAsync(match.TargetProjectId);
            var material      = await db.Materials.FindAsync(match.MaterialId);
            if (sourceProject is null || targetProject is null || material is null) continue;

            var unitCost = match.TransferQuantity > 0 ? match.EstimatedSavings / match.TransferQuantity : material.UnitCost;
            var priority = urgencyByProjectMaterial.TryGetValue((match.TargetProjectId, match.MaterialId), out var urgency)
                ? MapUrgencyToPriority(urgency)
                : RedistributionPriority.Medium;

            db.RedistributionRequests.Add(new RedistributionRequest
            {
                MaterialId              = match.MaterialId,
                SourceProjectId         = match.SourceProjectId,
                TargetProjectId         = match.TargetProjectId,
                Quantity                = match.TransferQuantity,
                AvailableExcessAtSource = match.AvailableExcess,
                NeededQuantityAtTarget  = match.NeededQuantity,
                UnitCost                = unitCost,
                EstimatedSavings        = match.EstimatedSavings,
                Priority                = priority,
                Status                  = RedistributionStatus.AiSuggested,
                IsAiRecommended         = true,
                Notes                   = $"AI-matched: {material.Name} excess at {sourceProject.Name} against a shortage at {targetProject.Name}.",
                RequestedAt             = DateTime.UtcNow,
            });
        }

        await db.SaveChangesAsync();
    }

    public async Task<bool> ApproveTransferAsync(int recommendationId, int userId)
    {
        var request = await db.RedistributionRequests.FindAsync(recommendationId);
        if (request is null) return false;
        if (request.Status is RedistributionStatus.Completed or RedistributionStatus.Rejected) return false;

        request.Status           = RedistributionStatus.Approved;
        request.ApprovedByUserId = userId;
        request.ApprovedAt       = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return true;
    }

    public async Task<RedistributionRecommendationDto> CreateFromExcessRecordAsync(RedistributeFromExcessDto dto, int userId)
    {
        var record = await db.ExcessWasteRecords
            .Include(e => e.Material)
            .Include(e => e.Project)
            .FirstOrDefaultAsync(e => e.Id == dto.ExcessWasteRecordId)
            ?? throw new KeyNotFoundException("Excess/waste record not found.");

        if (!record.IsReusable)
            throw new InvalidOperationException("This record isn't marked reusable — damaged or expired material can't be redistributed.");

        if (dto.TargetProjectId == record.ProjectId)
            throw new InvalidOperationException("Source and target project can't be the same.");

        var targetProject = await db.Projects.FindAsync(dto.TargetProjectId)
            ?? throw new KeyNotFoundException("Target project not found.");

        var quantity = dto.Quantity ?? record.Quantity;
        if (quantity > record.Quantity)
            throw new InvalidOperationException($"Only {record.Quantity} {record.Material.Unit} of this excess is logged.");

        var demand = await db.ProcurementRecommendations
            .Where(r => r.ProjectId == dto.TargetProjectId && r.MaterialId == record.MaterialId && r.CurrentStock < r.ReorderPoint)
            .OrderByDescending(r => r.GeneratedAt)
            .FirstOrDefaultAsync();

        var request = new RedistributionRequest
        {
            MaterialId              = record.MaterialId,
            SourceProjectId         = record.ProjectId,
            TargetProjectId         = dto.TargetProjectId,
            Quantity                = quantity,
            AvailableExcessAtSource = record.Quantity,
            NeededQuantityAtTarget  = demand?.RecommendedQuantity ?? quantity,
            UnitCost                = record.UnitCost,
            EstimatedSavings        = quantity * record.UnitCost,
            Priority                = demand is not null ? MapUrgencyToPriority(demand.UrgencyLevel) : RedistributionPriority.Medium,
            Status                  = RedistributionStatus.PendingApproval,
            IsAiRecommended         = false,
            Notes                   = dto.Notes ?? $"Manually redistributed from a logged excess record: {record.Material.Name} at {record.Project.Name}.",
            RequestedByUserId       = userId,
            RequestedAt             = DateTime.UtcNow,
        };

        db.RedistributionRequests.Add(request);
        await db.SaveChangesAsync();

        var saved = await db.RedistributionRequests
            .Include(r => r.Material)
            .Include(r => r.SourceProject)
            .Include(r => r.TargetProject)
            .FirstAsync(r => r.Id == request.Id);

        return ToDto(saved);
    }

    public async Task<IEnumerable<RedistributionTargetSuggestionDto>> SuggestTargetsAsync(int excessWasteRecordId)
    {
        var record = await db.ExcessWasteRecords
            .Include(e => e.Material).ThenInclude(m => m.Category)
            .Include(e => e.Project)
            .FirstOrDefaultAsync(e => e.Id == excessWasteRecordId)
            ?? throw new KeyNotFoundException("Excess/waste record not found.");

        var categoryId = record.Material.CategoryId;

        var candidateProjects = await db.Projects
            .Where(p => p.Id != record.ProjectId
                && p.Status != ProjectStatus.Completed
                && p.Status != ProjectStatus.Cancelled)
            .ToListAsync();

        // Signal 1: forecasted demand — a real reorder-point shortfall for this exact material.
        var shortageByProject = (await db.ProcurementRecommendations
            .Where(r => r.MaterialId == record.MaterialId && r.CurrentStock < r.ReorderPoint)
            .ToListAsync())
            .GroupBy(r => r.ProjectId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.GeneratedAt).First());

        // Signal 2: does the project even use this material's category at all (BOQ or current inventory)?
        var categoryUsageProjectIds = (await db.BOQItems
                .Where(b => b.Material.CategoryId == categoryId)
                .Select(b => b.ProjectId)
                .Distinct()
                .ToListAsync())
            .Concat(await db.InventoryRecords
                .Where(i => i.Material.CategoryId == categoryId)
                .Select(i => i.ProjectId)
                .Distinct()
                .ToListAsync())
            .ToHashSet();

        var suggestions = candidateProjects.Select(p =>
        {
            var hasShortage  = shortageByProject.TryGetValue(p.Id, out var shortage);
            var usesCategory = categoryUsageProjectIds.Contains(p.Id);
            var sameType     = p.Type == record.Project.Type;

            var score = (hasShortage ? 100 : 0) + (usesCategory ? 30 : 0) + (sameType ? 10 : 0);

            var reasons = new List<string>();
            if (hasShortage)  reasons.Add($"Forecasted shortage of {shortage!.RecommendedQuantity:0.##} {record.Material.Unit} detected");
            if (usesCategory) reasons.Add($"Already uses {record.Material.Category.Name} materials");
            if (sameType)     reasons.Add($"Same project type ({p.Type})");
            if (reasons.Count == 0) reasons.Add("No strong match signal — general candidate only");

            return new RedistributionTargetSuggestionDto
            {
                ProjectId                = p.Id,
                ProjectName              = p.Name,
                HasForecastedShortage    = hasShortage,
                ForecastedNeededQuantity = hasShortage ? shortage!.RecommendedQuantity : null,
                UsesThisMaterialCategory = usesCategory,
                SameProjectType          = sameType,
                MatchScore               = score,
                MatchReason              = string.Join(" · ", reasons),
            };
        })
        .OrderByDescending(s => s.MatchScore)
        .ToList();

        return suggestions;
    }

    private static RedistributionPriority MapUrgencyToPriority(UrgencyLevel urgency) => urgency switch
    {
        UrgencyLevel.Critical or UrgencyLevel.High => RedistributionPriority.High,
        UrgencyLevel.Medium                        => RedistributionPriority.Medium,
        _                                           => RedistributionPriority.Low,
    };

    private static RedistributionRecommendationDto ToDto(RedistributionRequest r) => new()
    {
        Id                = r.Id,
        SourceMaterialId  = r.MaterialId,
        MaterialName      = r.Material.Name,
        Unit              = r.Material.Unit,
        SourceProjectId   = r.SourceProjectId,
        SourceProjectName = r.SourceProject.Name,
        TargetProjectId   = r.TargetProjectId,
        TargetProjectName = r.TargetProject.Name,
        AvailableQuantity = r.AvailableExcessAtSource,
        NeededQuantity    = r.NeededQuantityAtTarget,
        TransferQuantity  = r.Quantity,
        UnitCost          = r.UnitCost,
        EstimatedSavings  = r.EstimatedSavings,
        Priority          = r.Priority.ToString(),
        Status            = r.Status.ToString(),
        IsAiRecommended   = r.IsAiRecommended,
        Notes             = r.Notes,
        GeneratedAt       = r.RequestedAt,
    };
}
