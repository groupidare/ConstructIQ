using ConstructIQ.API.Models.DTOs.Procurement;

namespace ConstructIQ.API.Services.Interfaces;

public interface IRedistributionService
{
    Task<IEnumerable<RedistributionRecommendationDto>> GetRecommendationsAsync();
    Task<IEnumerable<RedistributionRecommendationDto>> GetAllRecommendationsAsync();
    Task GenerateRecommendationsAsync();
    // Excess that moved between projects through a warehouse release.
    Task<IEnumerable<ExcessReleaseDto>> GetExcessReleasesAsync();
    Task<bool> ApproveTransferAsync(int recommendationId, int userId);
    Task<bool> RejectTransferAsync(int recommendationId, int userId);
    Task<bool> CancelApprovalAsync(int recommendationId);
    Task<RedistributionRecommendationDto> CreateFromExcessRecordAsync(RedistributeFromExcessDto dto, int userId);
    Task<IEnumerable<RedistributionTargetSuggestionDto>> SuggestTargetsAsync(int excessWasteRecordId);
    Task<IEnumerable<ReceivedRedistributionDto>> GetReceivedQuantitiesAsync(int projectId);
}
