using ConstructIQ.API.Models.DTOs.Procurement;

namespace ConstructIQ.API.Services.Interfaces;

public interface IProcurementService
{
    Task<IEnumerable<ProcurementRecommendationDto>> GetRecommendationsAsync(int projectId);
    Task GenerateRecommendationsAsync(int projectId);
    Task<PurchaseRequestDto> CreatePurchaseRequestAsync(PurchaseRequestCreateDto dto, int userId);
    Task<PurchaseRequestDto?> UpdateRequestStatusAsync(int requestId, string status, int userId);
}
