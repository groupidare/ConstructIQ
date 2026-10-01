using ConstructIQ.API.Models.DTOs.Measurement;

namespace ConstructIQ.API.Services.Interfaces;

public interface IMeasurementService
{
    Task<IEnumerable<MeasurementResponseDto>> GetByProjectAsync(int projectId);
    Task<IEnumerable<MeasurementResponseDto>> BulkSaveAsync(int projectId, List<MeasurementUpsertDto> items, int userId);
}
