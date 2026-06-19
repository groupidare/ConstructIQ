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
        return await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.RecordedBy)
            .Where(e => e.ProjectId == projectId)
            .OrderByDescending(e => e.RecordedAt)
            .Select(e => ToDto(e))
            .ToListAsync();
    }

    public async Task<ExcessWasteResponseDto> CreateAsync(ExcessWasteCreateDto dto, int userId)
    {
        var boqItem = await db.BOQItems
            .FirstOrDefaultAsync(b => b.ProjectId == dto.ProjectId
                && b.PhaseId == dto.PhaseId
                && b.MaterialId == dto.MaterialId);

        var excessPercent = boqItem is not null && boqItem.EstimatedQuantity > 0
            ? dto.Quantity / boqItem.EstimatedQuantity * 100
            : 0;

        var record = new ExcessWasteRecord
        {
            ProjectId       = dto.ProjectId,
            PhaseId         = dto.PhaseId,
            MaterialId      = dto.MaterialId,
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
            .FirstOrDefaultAsync(r => r.ProjectId == dto.ProjectId && r.MaterialId == dto.MaterialId);
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

        var saved = await db.ExcessWasteRecords
            .Include(e => e.Project).Include(e => e.Phase)
            .Include(e => e.Material).Include(e => e.RecordedBy)
            .FirstAsync(e => e.Id == record.Id);

        return ToDto(saved);
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

    private static ExcessWasteResponseDto ToDto(ExcessWasteRecord e) => new()
    {
        Id           = e.Id,
        ProjectId    = e.ProjectId,
        ProjectName  = e.Project?.Name ?? string.Empty,
        PhaseId      = e.PhaseId,
        PhaseName    = e.Phase?.Name ?? string.Empty,
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
    };
}
