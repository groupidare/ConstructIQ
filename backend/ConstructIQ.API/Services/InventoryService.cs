using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Inventory;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class InventoryService(AppDbContext db) : IInventoryService
{
    public async Task<IEnumerable<InventoryResponseDto>> GetByProjectAsync(int projectId)
    {
        return await db.InventoryRecords
            .Include(r => r.Material)
            .Where(r => r.ProjectId == projectId)
            .Select(r => ToDto(r))
            .ToListAsync();
    }

    public async Task<InventoryResponseDto?> GetByIdAsync(int id)
    {
        var r = await db.InventoryRecords.Include(r => r.Material).FirstOrDefaultAsync(r => r.Id == id);
        return r is null ? null : ToDto(r);
    }

    public async Task RecordMovementAsync(MovementCreateDto dto, int userId)
    {
        var record = await db.InventoryRecords
            .FirstOrDefaultAsync(r => r.ProjectId == dto.ProjectId && r.MaterialId == dto.MaterialId);

        if (record is null)
        {
            record = new InventoryRecord { ProjectId = dto.ProjectId, MaterialId = dto.MaterialId };
            db.InventoryRecords.Add(record);
        }

        var movementType = Enum.Parse<MovementType>(dto.MovementType);

        switch (movementType)
        {
            case MovementType.Received:
                record.AvailableQuantity += dto.Quantity;
                break;
            case MovementType.Released:
                record.AvailableQuantity -= dto.Quantity;
                record.UsedQuantity      += dto.Quantity;
                break;
            case MovementType.Returned:
                record.AvailableQuantity += dto.Quantity;
                break;
            case MovementType.Wasted:
                record.AvailableQuantity -= dto.Quantity;
                record.WastedQuantity    += dto.Quantity;
                break;
            case MovementType.Transferred:
                record.AvailableQuantity -= dto.Quantity;
                record.ExcessQuantity    -= dto.Quantity;
                break;
        }

        record.LastUpdated = DateTime.UtcNow;

        db.MaterialMovements.Add(new MaterialMovement
        {
            InventoryRecordId = record.Id,
            ProjectId         = dto.ProjectId,
            MaterialId        = dto.MaterialId,
            MovementType      = movementType,
            Quantity          = dto.Quantity,
            PhaseId           = dto.PhaseId,
            Notes             = dto.Notes,
            RecordedByUserId  = userId,
        });

        await db.SaveChangesAsync();
        await UpdateStockStatusAsync(dto.ProjectId);
    }

    public async Task UpdateStockStatusAsync(int projectId)
    {
        var records = await db.InventoryRecords
            .Where(r => r.ProjectId == projectId).ToListAsync();

        foreach (var r in records)
        {
            r.StockStatus = r.AvailableQuantity <= 0
                ? StockStatus.OutOfStock
                : r.AvailableQuantity <= r.ReorderPoint
                    ? StockStatus.LowStock
                    : r.AvailableQuantity > r.TargetStockLevel
                        ? StockStatus.Overstock
                        : StockStatus.Normal;
        }

        await db.SaveChangesAsync();
    }

    private static InventoryResponseDto ToDto(InventoryRecord r) => new()
    {
        Id                = r.Id,
        ProjectId         = r.ProjectId,
        MaterialId        = r.MaterialId,
        MaterialName      = r.Material?.Name ?? string.Empty,
        Specification     = r.Material?.Specification ?? string.Empty,
        Unit              = r.Material?.Unit ?? string.Empty,
        AvailableQuantity = r.AvailableQuantity,
        UsedQuantity      = r.UsedQuantity,
        WastedQuantity    = r.WastedQuantity,
        ExcessQuantity    = r.ExcessQuantity,
        ReorderPoint      = r.ReorderPoint,
        TargetStockLevel  = r.TargetStockLevel,
        StockStatus       = r.StockStatus.ToString(),
        LastUpdated       = r.LastUpdated,
    };
}
