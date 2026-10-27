using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Models.DTOs.Project;

namespace ConstructIQ.API.Services.Interfaces;

public interface IMaterialCostService
{
    // Null when the project doesn't exist.
    Task<EstimatedMaterialCostDto?> GetEstimatedMaterialCostAsync(int projectId);

    // Every project when projectId is null.
    Task<ExcessCostImpactDto> GetExcessCostImpactAsync(int? projectId, bool includeMaterialBreakdown);
}
