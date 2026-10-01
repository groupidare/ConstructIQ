using ConstructIQ.API.Models.DTOs.Inventory;

namespace ConstructIQ.API.Services.Interfaces;

public interface IInventoryService
{
    Task<IEnumerable<InventoryResponseDto>> GetByProjectAsync(int projectId, bool inStockOnly = false);
    Task<InventoryResponseDto?> GetByIdAsync(int id);
    Task RecordMovementAsync(MovementCreateDto dto, int userId);
    Task UpdateStockStatusAsync(int projectId);
}
