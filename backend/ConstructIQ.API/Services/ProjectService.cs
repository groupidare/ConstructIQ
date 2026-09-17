using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ProjectService(AppDbContext db) : IProjectService
{
    public async Task<IEnumerable<ProjectResponseDto>> GetAllAsync(int userId, string role)
    {
        var query = db.Projects
            .Include(p => p.ProjectManager)
            .Include(p => p.SiteEngineer)
            .Include(p => p.Phases)
            .AsQueryable();

        if (role is "SiteEngineer")
            query = query.Where(p => p.SiteEngineerId == userId);
        else if (role is "ProjectManager")
            query = query.Where(p => p.ProjectManagerId == userId);

        return await query.Select(p => ToDto(p)).ToListAsync();
    }

    public async Task<ProjectResponseDto?> GetByIdAsync(int id)
    {
        var p = await db.Projects
            .Include(p => p.ProjectManager)
            .Include(p => p.SiteEngineer)
            .Include(p => p.Phases.OrderBy(ph => ph.Order))
            .FirstOrDefaultAsync(p => p.Id == id);
        return p is null ? null : ToDto(p);
    }

    public async Task<ProjectResponseDto> CreateAsync(ProjectCreateDto dto, int createdByUserId)
    {
        var project = new Project
        {
            Name               = dto.Name,
            Type               = Enum.Parse<ProjectType>(dto.Type),
            OtherTypeSpecify   = dto.OtherTypeSpecify,
            Location           = dto.Location,
            Description        = dto.Description,
            Budget             = dto.Budget,
            StartDate          = dto.StartDate,
            TargetEndDate      = dto.TargetEndDate,
            AssignedContractor = dto.AssignedContractor,
            ProjectManagerId   = createdByUserId,
            SiteEngineerId     = dto.SiteEngineerId,
            Status             = string.IsNullOrWhiteSpace(dto.Status) ? ProjectStatus.Planning : Enum.Parse<ProjectStatus>(dto.Status),
        };

        foreach (var phaseDto in dto.Phases)
        {
            project.Phases.Add(new Phase
            {
                Name      = phaseDto.Name,
                Order     = phaseDto.Order,
                StartDate = phaseDto.StartDate,
                EndDate   = phaseDto.EndDate,
            });
        }

        db.Projects.Add(project);
        await db.SaveChangesAsync();
        return (await GetByIdAsync(project.Id))!;
    }

    public async Task<ProjectResponseDto?> UpdateAsync(int id, ProjectCreateDto dto)
    {
        var project = await db.Projects.Include(p => p.Phases).FirstOrDefaultAsync(p => p.Id == id);
        if (project is null) return null;

        project.Name               = dto.Name;
        project.Type               = Enum.Parse<ProjectType>(dto.Type);
        project.OtherTypeSpecify   = dto.OtherTypeSpecify;
        project.Location           = dto.Location;
        project.Description        = dto.Description;
        project.Budget             = dto.Budget;
        project.StartDate          = dto.StartDate;
        project.TargetEndDate      = dto.TargetEndDate;
        project.AssignedContractor = dto.AssignedContractor;
        project.SiteEngineerId     = dto.SiteEngineerId;
        if (!string.IsNullOrWhiteSpace(dto.Status))
            project.Status = Enum.Parse<ProjectStatus>(dto.Status);
        project.UpdatedAt          = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return await GetByIdAsync(id);
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var project = await db.Projects.FindAsync(id);
        if (project is null) return false;
        db.Projects.Remove(project);
        await db.SaveChangesAsync();
        return true;
    }

    private static ProjectResponseDto ToDto(Project p) => new()
    {
        Id                 = p.Id,
        Name               = p.Name,
        Type               = p.Type.ToString(),
        OtherTypeSpecify   = p.OtherTypeSpecify,
        Location           = p.Location,
        Description        = p.Description,
        Budget             = p.Budget,
        StartDate          = p.StartDate,
        TargetEndDate      = p.TargetEndDate,
        Status             = p.Status.ToString(),
        AssignedContractor = p.AssignedContractor,
        ProjectManagerId   = p.ProjectManagerId,
        ProjectManagerName = $"{p.ProjectManager?.FirstName} {p.ProjectManager?.LastName}",
        SiteEngineerId     = p.SiteEngineerId,
        SiteEngineerName   = p.SiteEngineer is null ? null : $"{p.SiteEngineer.FirstName} {p.SiteEngineer.LastName}",
        CreatedAt          = p.CreatedAt,
        UpdatedAt          = p.UpdatedAt,
        Phases             = p.Phases.Select(ph => new PhaseResponseDto
        {
            Id              = ph.Id,
            ProjectId       = ph.ProjectId,
            Name            = ph.Name,
            Order           = ph.Order,
            StartDate       = ph.StartDate,
            EndDate         = ph.EndDate,
            Status          = ph.Status.ToString(),
            ProgressPercent = ph.ProgressPercent,
        }).ToList(),
    };
}
