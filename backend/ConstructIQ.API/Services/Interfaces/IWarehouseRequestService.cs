using ConstructIQ.API.Models.DTOs.WarehouseRequests;

namespace ConstructIQ.API.Services.Interfaces;

public interface IWarehouseRequestService
{
    Task<IEnumerable<WarehouseRequestResponseDto>> GetAllAsync();
    Task<WarehouseRequestResponseDto> CreateAsync(WarehouseRequestCreateDto dto, int userId);
    Task<bool> ApproveAsync(int id, int userId);
}
