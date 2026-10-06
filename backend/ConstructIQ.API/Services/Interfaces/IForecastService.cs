using ConstructIQ.API.Models.DTOs.Forecast;

namespace ConstructIQ.API.Services.Interfaces;

public interface IForecastService
{
    Task<ForecastResponseDto> GenerateForecastAsync(ForecastRequestDto request, int userId);
    Task<IEnumerable<ForecastResponseDto>> GetByProjectAsync(int projectId);
    Task<ForecastAccuracyReportDto> GetAccuracyReportAsync(int projectId);
    Task<TrainingJobDto> StartTrainingAsync();
    Task<ModelStatusDto> GetModelStatusAsync();
    Task<TrainingDataReportDto> GetTrainingDataReportAsync();
    Task<TopForecastedDemandDto> GetTopForecastedDemandAsync(string? unit);
}
