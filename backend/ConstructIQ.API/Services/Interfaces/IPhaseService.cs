using ConstructIQ.API.Models.DTOs.Phase;
using ConstructIQ.API.Models.DTOs.Project;

namespace ConstructIQ.API.Services.Interfaces;

public interface IPhaseService
{
    Task<PhaseResponseDto> CreateAsync(AddPhaseDto dto);
    Task<bool> DeleteAsync(int id);
}
