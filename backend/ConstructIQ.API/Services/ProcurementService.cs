using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Procurement;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ProcurementService(AppDbContext db) : IProcurementService
{
    private const int DefaultLeadTimeDays = 7;

    public async Task<IEnumerable<ProcurementRecommendationDto>> GetRecommendationsAsync(int projectId)
    {
        return await db.ProcurementRecommendations
            .Include(r => r.Material)
            .Where(r => r.ProjectId == projectId)
            .OrderByDescending(r => r.GeneratedAt)
            .Select(r => ToDto(r))
            .ToListAsync();
    }

    public async Task GenerateRecommendationsAsync(int projectId)
    {
        var inventory = await db.InventoryRecords
            .Include(r => r.Material)
            .Where(r => r.ProjectId == projectId)
            .ToListAsync();

        var forecastResult = await db.ForecastResults
            .Include(f => f.ForecastedMaterials)
            .Where(f => f.ProjectId == projectId)
            .OrderByDescending(f => f.GeneratedAt)
            .FirstOrDefaultAsync();

        var activePhase = await db.Phases
            .Where(p => p.ProjectId == projectId && p.Status == PhaseStatus.Active)
            .FirstOrDefaultAsync();

        var daysUntilPhase = activePhase is not null
            ? (activePhase.StartDate - DateTime.UtcNow).Days
            : int.MaxValue;

        foreach (var inv in inventory)
        {
            var forecasted = forecastResult?.ForecastedMaterials
                .FirstOrDefault(fm => fm.MaterialId == inv.MaterialId);
            if (forecasted is null) continue;

            var leadTime = DynamicLeadTimeCalc.Calculate(
                DefaultLeadTimeDays,
                daysUntilPhaseStart: daysUntilPhase,
                isUrgent: forecasted.RiskLevel == RiskLevel.Critical);

            var rop = ReorderPointCalculator.Calculate(
                avgDailyUsage: forecasted.ForecastedQuantity / 30,
                leadTimeDays:  leadTime);

            var tsl = TargetStockLevelCalc.Calculate(
                reorderPoint:      rop,
                annualDemand:      forecasted.ForecastedQuantity * 12,
                orderingCost:      500,
                holdingCostPerUnit: inv.Material.UnitCost * 0.2m > 0
                    ? inv.Material.UnitCost * 0.2m
                    : 1m);

            if (inv.AvailableQuantity > rop) continue;

            var recommended = tsl - inv.AvailableQuantity;

            var existing = await db.ProcurementRecommendations
                .FirstOrDefaultAsync(r => r.ProjectId == projectId && r.MaterialId == inv.MaterialId);

            if (existing is not null)
            {
                existing.CurrentStock         = inv.AvailableQuantity;
                existing.ReorderPoint         = rop;
                existing.TargetStockLevel     = tsl;
                existing.ForecastedDemand     = forecasted.ForecastedQuantity;
                existing.RecommendedQuantity  = recommended;
                existing.EstimatedCost        = recommended * inv.Material.UnitCost;
                existing.EstimatedLeadTimeDays= leadTime;
                existing.SuggestedReorderDate = DateTime.UtcNow.AddDays(2);
                existing.UrgencyLevel         = forecasted.RiskLevel switch
                {
                    RiskLevel.Critical => UrgencyLevel.Critical,
                    RiskLevel.High     => UrgencyLevel.High,
                    RiskLevel.Medium   => UrgencyLevel.Medium,
                    _                  => UrgencyLevel.Low,
                };
                existing.GeneratedAt = DateTime.UtcNow;
            }
            else
            {
                db.ProcurementRecommendations.Add(new ProcurementRecommendation
                {
                    ProjectId             = projectId,
                    MaterialId            = inv.MaterialId,
                    CurrentStock          = inv.AvailableQuantity,
                    ReorderPoint          = rop,
                    TargetStockLevel      = tsl,
                    ForecastedDemand      = forecasted.ForecastedQuantity,
                    RecommendedQuantity   = recommended,
                    EstimatedCost         = recommended * inv.Material.UnitCost,
                    EstimatedLeadTimeDays = leadTime,
                    SuggestedReorderDate  = DateTime.UtcNow.AddDays(2),
                    UrgencyLevel          = UrgencyLevel.Medium,
                });
            }
        }

        await db.SaveChangesAsync();
    }

    public async Task<PurchaseRequestDto> CreatePurchaseRequestAsync(PurchaseRequestCreateDto dto, int userId)
    {
        var pr = new PurchaseRequest
        {
            ProjectId           = dto.ProjectId,
            RecommendationId    = dto.RecommendationId,
            MaterialId          = dto.MaterialId,
            RequestedQuantity   = dto.RequestedQuantity,
            EstimatedUnitCost   = dto.EstimatedUnitCost,
            TotalEstimatedCost  = dto.RequestedQuantity * dto.EstimatedUnitCost,
            Notes               = dto.Notes,
            RequestedByUserId   = userId,
        };

        db.PurchaseRequests.Add(pr);
        await db.SaveChangesAsync();

        var saved = await db.PurchaseRequests
            .Include(p => p.Project).Include(p => p.Material)
            .Include(p => p.RequestedBy).Include(p => p.ApprovedBy)
            .FirstAsync(p => p.Id == pr.Id);

        return ToPrDto(saved);
    }

    public async Task<PurchaseRequestDto?> UpdateRequestStatusAsync(int requestId, string status, int userId)
    {
        var pr = await db.PurchaseRequests
            .Include(p => p.Project).Include(p => p.Material)
            .Include(p => p.RequestedBy)
            .FirstOrDefaultAsync(p => p.Id == requestId);

        if (pr is null) return null;

        pr.Status = Enum.Parse<PurchaseRequestStatus>(status);
        if (pr.Status == PurchaseRequestStatus.Approved)
        {
            pr.ApprovedByUserId = userId;
            pr.ApprovedAt       = DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return ToPrDto(pr);
    }

    private static ProcurementRecommendationDto ToDto(ProcurementRecommendation r) => new()
    {
        Id                    = r.Id,
        ProjectId             = r.ProjectId,
        MaterialId            = r.MaterialId,
        MaterialName          = r.Material?.Name ?? string.Empty,
        Unit                  = r.Material?.Unit ?? string.Empty,
        CurrentStock          = r.CurrentStock,
        ReorderPoint          = r.ReorderPoint,
        TargetStockLevel      = r.TargetStockLevel,
        ForecastedDemand      = r.ForecastedDemand,
        RecommendedQuantity   = r.RecommendedQuantity,
        EstimatedCost         = r.EstimatedCost,
        SuggestedReorderDate  = r.SuggestedReorderDate,
        EstimatedLeadTimeDays = r.EstimatedLeadTimeDays,
        UrgencyLevel          = r.UrgencyLevel.ToString(),
        Notes                 = r.Notes,
        GeneratedAt           = r.GeneratedAt,
    };

    private static PurchaseRequestDto ToPrDto(PurchaseRequest p) => new()
    {
        Id                 = p.Id,
        ProjectId          = p.ProjectId,
        ProjectName        = p.Project?.Name ?? string.Empty,
        RecommendationId   = p.RecommendationId,
        MaterialId         = p.MaterialId,
        MaterialName       = p.Material?.Name ?? string.Empty,
        Unit               = p.Material?.Unit ?? string.Empty,
        RequestedQuantity  = p.RequestedQuantity,
        EstimatedUnitCost  = p.EstimatedUnitCost,
        TotalEstimatedCost = p.TotalEstimatedCost,
        Status             = p.Status.ToString(),
        RequestedBy        = p.RequestedBy is null ? string.Empty : $"{p.RequestedBy.FirstName} {p.RequestedBy.LastName}",
        RequestedAt        = p.RequestedAt,
        ApprovedBy         = p.ApprovedBy is null ? null : $"{p.ApprovedBy.FirstName} {p.ApprovedBy.LastName}",
        ApprovedAt         = p.ApprovedAt,
        Notes              = p.Notes,
    };
}
