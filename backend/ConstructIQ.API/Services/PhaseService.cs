using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Phase;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class PhaseService(AppDbContext db) : IPhaseService
{
    public async Task<PhaseResponseDto> CreateAsync(AddPhaseDto dto)
    {
        _ = await db.Projects.FindAsync(dto.ProjectId)
            ?? throw new KeyNotFoundException("Project not found.");

        var order = dto.Order ?? (await db.Phases.Where(p => p.ProjectId == dto.ProjectId).CountAsync()) + 1;

        var phase = new Phase
        {
            ProjectId = dto.ProjectId,
            Name      = dto.Name,
            Order     = order,
            StartDate = dto.StartDate,
            EndDate   = dto.EndDate,
        };

        db.Phases.Add(phase);
        await db.SaveChangesAsync();

        return ToDto(phase);
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var phase = await db.Phases.FindAsync(id);
        if (phase is null) return false;
        db.Phases.Remove(phase);
        await db.SaveChangesAsync();
        return true;
    }

    private static PhaseResponseDto ToDto(Phase p) => new()
    {
        Id              = p.Id,
        ProjectId       = p.ProjectId,
        Name            = p.Name,
        Order           = p.Order,
        StartDate       = p.StartDate,
        EndDate         = p.EndDate,
        Status          = p.Status.ToString(),
        ProgressPercent = p.ProgressPercent,
    };
}
