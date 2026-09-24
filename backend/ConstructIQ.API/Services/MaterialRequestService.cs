using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.MaterialRequest;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class MaterialRequestService(AppDbContext db) : IMaterialRequestService
{
    public async Task<IEnumerable<MaterialRequestResponseDto>> GetAllAsync()
    {
        var rows = await db.MaterialRequests
            .Include(m => m.Project)
            .Include(m => m.Material)
            .Include(m => m.RequestedBy)
            .Include(m => m.ApprovedBy)
            .OrderByDescending(m => m.RequestedAt)
            .ToListAsync();

        return rows.Select(ToDto);
    }

    public async Task<MaterialRequestResponseDto> CreateAsync(MaterialRequestCreateDto dto, int userId)
    {
        var request = new MaterialRequest
        {
            ProjectId         = dto.ProjectId,
            MaterialId        = dto.MaterialId,
            RequestedQuantity = dto.RequestedQuantity,
            RequestedByUserId = userId,
        };

        db.MaterialRequests.Add(request);
        await db.SaveChangesAsync();

        var saved = await db.MaterialRequests
            .Include(m => m.Project)
            .Include(m => m.Material)
            .Include(m => m.RequestedBy)
            .Include(m => m.ApprovedBy)
            .FirstAsync(m => m.Id == request.Id);

        return ToDto(saved);
    }

    public async Task<bool> ApproveAsync(int id, int userId)
    {
        var request = await db.MaterialRequests.FindAsync(id);
        if (request is null || request.Status != MaterialRequestStatus.Pending) return false;

        request.Status           = MaterialRequestStatus.Approved;
        request.ApprovedByUserId = userId;
        request.ApprovedAt       = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return true;
    }

    private static MaterialRequestResponseDto ToDto(MaterialRequest m) => new()
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
