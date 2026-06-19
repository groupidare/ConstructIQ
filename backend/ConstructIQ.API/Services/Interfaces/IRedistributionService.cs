using ConstructIQ.API.Models.DTOs.Procurement;

namespace ConstructIQ.API.Services.Interfaces;

public interface IRedistributionService
{
    Task<IEnumerable<RedistributionRecommendationDto>> GetRecommendationsAsync();
    Task GenerateRecommendationsAsync();
    Task<bool> ApproveTransferAsync(int recommendationId, int userId);
}
