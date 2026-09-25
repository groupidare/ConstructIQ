using ConstructIQ.API.Models.DTOs.BOQ;

namespace ConstructIQ.API.Services.Interfaces;

public interface IBOQService
{
    Task<IEnumerable<BOQItemResponseDto>> GetByProjectAsync(int projectId);
    Task<IEnumerable<BOQItemResponseDto>> BulkSaveAsync(int projectId, List<BOQItemUpsertDto> items, int userId);
    Task<bool> DeleteAsync(int id);
    Task<HistoricalEstimateResponseDto> GetHistoricalEstimateAsync(string primarySection, string materialDescription, string? projectType);
    Task<IEnumerable<MonthlyDemandSummaryDto>> GetMonthlyDemandSummaryAsync();
}
