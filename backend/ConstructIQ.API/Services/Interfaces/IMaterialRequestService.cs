using ConstructIQ.API.Models.DTOs.MaterialRequest;

namespace ConstructIQ.API.Services.Interfaces;

public interface IMaterialRequestService
{
    Task<IEnumerable<MaterialRequestResponseDto>> GetAllAsync();
    Task<MaterialRequestResponseDto> CreateAsync(MaterialRequestCreateDto dto, int userId);
    Task<bool> ApproveAsync(int id, int userId);
}
