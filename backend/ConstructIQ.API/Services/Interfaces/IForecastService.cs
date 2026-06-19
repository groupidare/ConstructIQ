using ConstructIQ.API.Models.DTOs.Forecast;

namespace ConstructIQ.API.Services.Interfaces;

public interface IForecastService
{
    Task<ForecastResponseDto> GenerateForecastAsync(ForecastRequestDto request);
    Task<IEnumerable<ForecastResponseDto>> GetByProjectAsync(int projectId);
    Task<ForecastAccuracyReportDto> GetAccuracyReportAsync(int projectId);
}
