using ConstructIQ.API.Models.DTOs.ExcessWaste;

namespace ConstructIQ.API.Services.Interfaces;

public interface IExcessWasteService
{
    Task<IEnumerable<ExcessWasteResponseDto>> GetByProjectAsync(int projectId);
    Task<ExcessWasteResponseDto> CreateAsync(ExcessWasteCreateDto dto, int userId);
    Task<ExcessWasteResponseDto> UpdateAsync(int id, ExcessWasteUpdateDto dto);
    Task DeleteAsync(int id);
    Task<ExcessAnalyticsSummaryDto> GetSummaryAsync(int projectId);
    Task<IEnumerable<PendingBOQItemDto>> GetLoggableBOQItemsAsync(int projectId);
    Task<IEnumerable<int>> GetProjectIdsWithBOQItemsAsync();
    Task ConfirmNoExcessWasteAsync(int projectId, IReadOnlyCollection<int> boqItemIds, int userId);
}
