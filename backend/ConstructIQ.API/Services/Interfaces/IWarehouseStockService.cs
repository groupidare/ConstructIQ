using ConstructIQ.API.Models.DTOs.WarehouseStock;

namespace ConstructIQ.API.Services.Interfaces;

public interface IWarehouseStockService
{
    Task<IEnumerable<WarehouseStockItemDto>> GetAllAsync();
    Task<WarehouseStockSyncResultDto> SyncFromGoogleSheetAsync();
}
