using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ProjectService(AppDbContext db, IWebHostEnvironment env) : IProjectService
{
    private static readonly Dictionary<string, string> AllowedPhotoTypes = new()
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"]  = ".png",
        ["image/webp"] = ".webp",
    };
    private const long MaxPhotoBytes = 5 * 1024 * 1024; // 5 MB

    // Below this, a project is still being set up (materials/suppliers/POs
    // lined up) rather than actually under construction on site.
    private const int ActiveThreshold = 10;

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
            IsHistorical       = dto.IsHistorical,
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

    public async Task<IEnumerable<ProjectProgressUpdateDto>> GetProgressUpdatesAsync(int projectId)
    {
        return await db.ProjectProgressUpdates
            .Where(u => u.ProjectId == projectId)
            .Include(u => u.UpdatedBy)
            .Include(u => u.Photos)
            .OrderByDescending(u => u.CreatedAt)
            .Select(u => ToUpdateDto(u))
            .ToListAsync();
    }

    public async Task<LogProgressResultDto?> LogProgressAsync(int projectId, SubmitProgressUpdateDto dto, int userId)
    {
        var project = await db.Projects.Include(p => p.Phases).FirstOrDefaultAsync(p => p.Id == projectId);
        if (project is null) return null;

        var uploadsDir = Path.Combine(env.WebRootPath, "uploads", "progress");
        Directory.CreateDirectory(uploadsDir);

        var photos = new List<ProjectProgressPhoto>();
        foreach (var file in dto.Photos)
        {
            if (file.Length == 0) continue;
            if (file.Length > MaxPhotoBytes)
                throw new InvalidOperationException("Each photo must be 5MB or smaller.");
            if (!AllowedPhotoTypes.TryGetValue(file.ContentType, out var ext))
                throw new InvalidOperationException("Only JPEG, PNG, or WebP images are allowed.");

            var fileName = $"{projectId}_{Guid.NewGuid():N}{ext}";
            await using (var stream = File.Create(Path.Combine(uploadsDir, fileName)))
                await file.CopyToAsync(stream);
            photos.Add(new ProjectProgressPhoto { Url = $"/uploads/progress/{fileName}" });
        }

        var update = new ProjectProgressUpdate
        {
            ProjectId       = projectId,
            Progress        = dto.Progress,
            Notes           = dto.Notes.Trim(),
            UpdatedByUserId = userId,
            Photos          = photos,
        };
        db.ProjectProgressUpdates.Add(update);

        project.Progress = dto.Progress;
        // A project reaching 100% is done — same finished-project bucket as
        // one backfilled via "Add Completed Project" (see Project.IsHistorical),
        // so its real BOQ/PO data becomes forecast training data too. Below
        // that, crossing the "actually started" threshold moves it out of
        // Planning on its own — no one has to remember to flip it by hand.
        if (dto.Progress >= 100)
        {
            project.Status = ProjectStatus.Completed;
            project.IsHistorical = true;
        }
        else if (project.Status == ProjectStatus.Planning && dto.Progress > ActiveThreshold)
        {
            project.Status = ProjectStatus.Active;
        }
        project.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        var updatedProject = await GetByIdAsync(projectId);
        var updatedByUser = await db.Users.FindAsync(userId);
        return new LogProgressResultDto
        {
            Project = updatedProject!,
            Update = new ProjectProgressUpdateDto
            {
                Id            = update.Id,
                Progress      = update.Progress,
                Notes         = update.Notes,
                PhotoUrls     = photos.Select(ph => ph.Url).ToList(),
                UpdatedByName = updatedByUser is null ? "Unknown" : $"{updatedByUser.FirstName} {updatedByUser.LastName}",
                CreatedAt     = update.CreatedAt,
            },
        };
    }

    private static ProjectProgressUpdateDto ToUpdateDto(ProjectProgressUpdate u) => new()
    {
        Id            = u.Id,
        Progress      = u.Progress,
        Notes         = u.Notes,
        PhotoUrls     = u.Photos.Select(ph => ph.Url).ToList(),
        UpdatedByName = $"{u.UpdatedBy.FirstName} {u.UpdatedBy.LastName}",
        CreatedAt     = u.CreatedAt,
    };

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
        Progress           = p.Progress,
        IsHistorical       = p.IsHistorical,
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
