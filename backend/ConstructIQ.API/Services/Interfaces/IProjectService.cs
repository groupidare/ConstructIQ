using ConstructIQ.API.Models.DTOs.Project;

namespace ConstructIQ.API.Services.Interfaces;

public interface IProjectService
{
    Task<IEnumerable<ProjectResponseDto>> GetAllAsync(int requestingUserId, string role);
    Task<ProjectResponseDto?> GetByIdAsync(int id);
    Task<ProjectResponseDto> CreateAsync(ProjectCreateDto dto, int createdByUserId);
    Task<ProjectResponseDto?> UpdateAsync(int id, ProjectCreateDto dto);
    Task<bool> DeleteAsync(int id);
    Task<IEnumerable<ProjectProgressUpdateDto>> GetProgressUpdatesAsync(int projectId);
    Task<LogProgressResultDto?> LogProgressAsync(int projectId, SubmitProgressUpdateDto dto, int userId);
}
