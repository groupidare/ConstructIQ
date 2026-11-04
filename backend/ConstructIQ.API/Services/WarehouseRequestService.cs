using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class WarehouseRequestService(AppDbContext db, INotificationService notifications) : IWarehouseRequestService
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

        return await ToDtosWithLinksAsync(rows);
    }

    public async Task<WarehouseRequestResponseDto> CreateAsync(WarehouseRequestCreateDto dto, int userId)
    {
        var row = await ProcurementCapCalculator.FindRequestRowAsync(db, dto.BOQItemId, dto.ProjectId, dto.MaterialId);

        // Nothing counts as released until a request is actually Approved (see
        // ProcurementCapCalculator), so nothing else stops the same row being
        // asked for twice while one check is still outstanding — block that
        // directly instead. A request with no row could be for any of them.
        var hasPending = await db.WarehouseRequests.AnyAsync(w =>
            w.ProjectId == dto.ProjectId && w.MaterialId == dto.MaterialId && w.Status == WarehouseRequestStatus.Pending
            && (dto.BOQItemId == null || w.BOQItemId == null || w.BOQItemId == dto.BOQItemId));
        if (hasPending)
            throw new InvalidOperationException("A warehouse check for this material is already pending — wait for it to be approved or rejected before sending another.");

        // No upper cap: materials can run short before a project ends, and the
        // warehouse should get the chance before anything is bought. Anything
        // past what the row still needs is flagged, and the warehouse decides.
        var remaining = await ProcurementCapCalculator.GetRemainingRequestableAsync(db, dto.ProjectId, dto.MaterialId, row?.Id);
        var hasPurchaseEstimate = row is not null
            ? row.EstimatedPurchaseQuantity != null
            : await db.BOQItems.AnyAsync(b => b.ProjectId == dto.ProjectId && b.MaterialId == dto.MaterialId && b.EstimatedPurchaseQuantity != null);
        var isAdditional = hasPurchaseEstimate && dto.RequestedQuantity > remaining;

        var request = new WarehouseRequest
        {
            ProjectId         = dto.ProjectId,
            MaterialId        = dto.MaterialId,
            BOQItemId         = row?.Id,
            RequestedQuantity = dto.RequestedQuantity,
            Unit              = dto.Unit?.Trim() ?? string.Empty,
            IsAdditional      = isAdditional,
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

        await notifications.CreateForRoleAsync(UserRole.WarehousePersonnel, NotificationKind.WarehouseCheck,
            isAdditional
                ? $"{saved.Project.Name} requested {dto.RequestedQuantity} {UnitOf(saved)} of {saved.Material.Name} — an additional request beyond the estimate."
                : $"{saved.Project.Name} requested {dto.RequestedQuantity} {UnitOf(saved)} of {saved.Material.Name}.",
            userId, actionLink: "/inventory");

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

        return await ToDtosWithLinksAsync(rows);
    }

    // Links belong to a row's BOQ wording, and saving can merge a row into a
    // differently-named catalog Material. So this goes back through the request's
    // own BOQ row — or, for an older request with none, the project's rows for
    // that Material. Those can link to different items, which can't say which one
    // the request meant: none is shown.
    private async Task<List<WarehouseRequestResponseDto>> ToDtosWithLinksAsync(List<WarehouseRequest> rows)
    {
        var dtos = rows.Select(ToDto).ToList();
        var links = await db.WarehouseStockLinks
            .Where(l => l.WarehouseMaterialName != null)
            .ToDictionaryAsync(l => l.BoqNameKey, l => l.WarehouseMaterialName!);
        if (links.Count == 0) return dtos;

        var projectIds = rows.Select(r => r.ProjectId).Distinct().ToList();
        var boqRows = await db.BOQItems
            .Where(b => projectIds.Contains(b.ProjectId))
            .Select(b => new { b.Id, b.ProjectId, b.MaterialId, b.Specification })
            .ToListAsync();
        var stock = (await db.WarehouseStockItems.ToListAsync())
            .GroupBy(i => StockInSheetRows.NameKey(i.MaterialName))
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var dto in dtos)
        {
            // A request that knows its row asks about that row alone.
            var rowNames = boqRows.Where(b => b.Id == dto.BOQItemId).Select(b => b.Specification ?? string.Empty).ToList();
            var names = rowNames.Count > 0
                ? rowNames
                : boqRows.Where(b => b.ProjectId == dto.ProjectId && b.MaterialId == dto.MaterialId)
                    .Select(b => b.Specification ?? string.Empty)
                    .Append(dto.MaterialName)
                    .ToList();
            var linked = names
                .Select(name => links.GetValueOrDefault(StockInSheetRows.NameKey(name)))
                .Where(name => name is not null)
                .Distinct()
                .ToList();
            if (linked.Count != 1) continue;

            dto.LinkedStockName = linked[0];
            if (stock.TryGetValue(StockInSheetRows.NameKey(linked[0]!), out var item))
            {
                dto.LinkedStockUnit    = item.Unit;
                dto.LinkedStockBalance = item.Balance;
            }
        }
        return dtos;
    }

    private static string UnitOf(WarehouseRequest m) =>
        string.IsNullOrWhiteSpace(m.Unit) ? m.Material.Unit : m.Unit;

    private static WarehouseRequestResponseDto ToDto(WarehouseRequest m) => new()
    {
        Id                = m.Id,
        ProjectId         = m.ProjectId,
        ProjectName       = m.Project.Name,
        MaterialId        = m.MaterialId,
        MaterialName      = m.Material.Name,
        Unit              = UnitOf(m),
        BOQItemId         = m.BOQItemId,
        IsAdditional      = m.IsAdditional,
        RequestedQuantity = m.RequestedQuantity,
        ApprovedQuantity  = m.ApprovedQuantity,
        Status            = m.Status.ToString(),
        RequestedBy       = $"{m.RequestedBy.FirstName} {m.RequestedBy.LastName}",
        RequestedAt       = m.RequestedAt,
        ApprovedBy        = m.ApprovedBy is null ? null : $"{m.ApprovedBy.FirstName} {m.ApprovedBy.LastName}",
        ApprovedAt        = m.ApprovedAt,
    };
}
