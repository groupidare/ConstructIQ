using ConstructIQ.API.Models.DTOs.ExcessWaste;

namespace ConstructIQ.API.Services.Interfaces;

public interface IExcessWasteService
{
    Task<IEnumerable<ExcessWasteResponseDto>> GetByProjectAsync(int projectId);
    Task<ExcessWasteResponseDto> CreateAsync(ExcessWasteCreateDto dto, int userId);
    Task<ExcessWasteResponseDto> UpdateAsync(int id, ExcessWasteUpdateDto dto);
    Task<ExcessAnalyticsSummaryDto> GetSummaryAsync(int projectId);
}
