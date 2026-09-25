using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class WarehouseRequestService(AppDbContext db) : IWarehouseRequestService
{
    public async Task<IEnumerable<WarehouseRequestResponseDto>> GetAllAsync()
    {
        var rows = await db.WarehouseRequests
            .Include(m => m.Project)
            .Include(m => m.Material)
            .Include(m => m.RequestedBy)
            .Include(m => m.ApprovedBy)
            .OrderByDescending(m => m.RequestedAt)
            .ToListAsync();

        return rows.Select(ToDto);
    }

    public async Task<WarehouseRequestResponseDto> CreateAsync(WarehouseRequestCreateDto dto, int userId)
    {
        var request = new WarehouseRequest
        {
            ProjectId         = dto.ProjectId,
            MaterialId        = dto.MaterialId,
            RequestedQuantity = dto.RequestedQuantity,
            RequestedByUserId = userId,
        };

        db.WarehouseRequests.Add(request);
        await db.SaveChangesAsync();

        var saved = await db.WarehouseRequests
            .Include(m => m.Project)
            .Include(m => m.Material)
            .Include(m => m.RequestedBy)
            .Include(m => m.ApprovedBy)
            .FirstAsync(m => m.Id == request.Id);

        return ToDto(saved);
    }

    public async Task<bool> ApproveAsync(int id, int userId)
    {
        var request = await db.WarehouseRequests.FindAsync(id);
        if (request is null || request.Status != WarehouseRequestStatus.Pending) return false;

        request.Status           = WarehouseRequestStatus.Approved;
        request.ApprovedByUserId = userId;
        request.ApprovedAt       = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return true;
    }

    private static WarehouseRequestResponseDto ToDto(WarehouseRequest m) => new()
    {
        Id                = m.Id,
        ProjectId         = m.ProjectId,
        ProjectName       = m.Project.Name,
        MaterialId        = m.MaterialId,
        MaterialName      = m.Material.Name,
        Unit              = m.Material.Unit,
        RequestedQuantity = m.RequestedQuantity,
        Status            = m.Status.ToString(),
        RequestedBy       = $"{m.RequestedBy.FirstName} {m.RequestedBy.LastName}",
        RequestedAt       = m.RequestedAt,
        ApprovedBy        = m.ApprovedBy is null ? null : $"{m.ApprovedBy.FirstName} {m.ApprovedBy.LastName}",
        ApprovedAt        = m.ApprovedAt,
    };
}
