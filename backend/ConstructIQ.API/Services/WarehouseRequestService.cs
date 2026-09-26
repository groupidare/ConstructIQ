using ConstructIQ.API.Algorithms;
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
        // Nothing counts as released until a request is actually Approved (see
        // ProcurementCapCalculator), so the cap alone can't stop the same
        // material being asked for twice while one check is still outstanding
        // — block that directly instead.
        var hasPending = await db.WarehouseRequests.AnyAsync(w =>
            w.ProjectId == dto.ProjectId && w.MaterialId == dto.MaterialId && w.Status == WarehouseRequestStatus.Pending);
        if (hasPending)
            throw new InvalidOperationException("A warehouse check for this material is already pending — wait for it to be approved or rejected before sending another.");

        var remaining = await ProcurementCapCalculator.GetRemainingRequestableAsync(db, dto.ProjectId, dto.MaterialId);
        if (dto.RequestedQuantity > remaining)
        {
            var material = await db.Materials.FindAsync(dto.MaterialId);
            throw new InvalidOperationException($"Cannot request more than {remaining} {material?.Unit} — that exceeds the estimated need minus what's already been redistributed in and requested.");
        }

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

    public async Task<bool> ApproveAsync(int id, decimal approvedQuantity, int userId)
    {
        var request = await db.WarehouseRequests.FindAsync(id);
        if (request is null || request.Status != WarehouseRequestStatus.Pending) return false;

        // The warehouse can release less than was asked (e.g. only 3 of 12,
        // because that's all that's on hand) but never more.
        if (approvedQuantity > request.RequestedQuantity)
            throw new InvalidOperationException($"Can't approve more than the {request.RequestedQuantity} originally requested.");

        request.Status           = WarehouseRequestStatus.Approved;
        request.ApprovedQuantity = approvedQuantity;
        request.ApprovedByUserId = userId;
        request.ApprovedAt       = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> RejectAsync(int id, int userId)
    {
        var request = await db.WarehouseRequests.FindAsync(id);
        if (request is null || request.Status != WarehouseRequestStatus.Pending) return false;

        request.Status = WarehouseRequestStatus.Rejected;

        await db.SaveChangesAsync();
        return true;
    }

    // Every warehouse request for one project (any status) — used by the
    // Material Plan tab to gate Notify Procurement: it only unlocks once a
    // material's warehouse check has actually been resolved (approved or
    // rejected), not while it's still pending.
    public async Task<IEnumerable<WarehouseRequestResponseDto>> GetByProjectAsync(int projectId)
    {
        var rows = await db.WarehouseRequests
            .Include(m => m.Project)
            .Include(m => m.Material)
            .Include(m => m.RequestedBy)
            .Include(m => m.ApprovedBy)
            .Where(m => m.ProjectId == projectId)
            .OrderByDescending(m => m.RequestedAt)
            .ToListAsync();

        return rows.Select(ToDto);
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
        ApprovedQuantity  = m.ApprovedQuantity,
        Status            = m.Status.ToString(),
        RequestedBy       = $"{m.RequestedBy.FirstName} {m.RequestedBy.LastName}",
        RequestedAt       = m.RequestedAt,
        ApprovedBy        = m.ApprovedBy is null ? null : $"{m.ApprovedBy.FirstName} {m.ApprovedBy.LastName}",
        ApprovedAt        = m.ApprovedAt,
    };
}
