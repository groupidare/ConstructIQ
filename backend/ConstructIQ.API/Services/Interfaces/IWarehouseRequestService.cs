using ConstructIQ.API.Models.DTOs.WarehouseRequests;

namespace ConstructIQ.API.Services.Interfaces;

public interface IWarehouseRequestService
{
    Task<IEnumerable<WarehouseRequestResponseDto>> GetAllAsync();
    Task<IEnumerable<WarehouseRequestResponseDto>> GetByProjectAsync(int projectId);
    Task<WarehouseRequestResponseDto> CreateAsync(WarehouseRequestCreateDto dto, int userId);
    Task<bool> ApproveAsync(int id, decimal approvedQuantity, int userId);
    Task<bool> RejectAsync(int id, int userId);
}
