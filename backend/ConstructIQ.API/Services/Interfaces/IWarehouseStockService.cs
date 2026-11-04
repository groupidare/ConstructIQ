using ConstructIQ.API.Models.DTOs.WarehouseStock;

namespace ConstructIQ.API.Services.Interfaces;

public interface IWarehouseStockService
{
    Task<IEnumerable<WarehouseStockItemDto>> GetAllAsync();
    Task<IEnumerable<WarehouseStockItemDto>> GetCurrentAsync();
    Task<WarehouseStockSyncResultDto> SyncFromGoogleSheetAsync();
    Task<IEnumerable<WarehouseStockLinkDto>> GetLinksAsync();
    Task<WarehouseStockLinkDto> SaveLinkAsync(string boqName, string? warehouseMaterialName);
    Task RemoveLinkAsync(string boqName);
}
