using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ProjectService(AppDbContext db, IWebHostEnvironment env, IWeatherGeocodingService geocoding) : IProjectService
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

    // Every role with access to the Projects page sees every project — only
    // editing is restricted (Admin/ProjectManager freely, SiteEngineer only
    // on the project they're assigned to; see IProjectAccessService).
    public async Task<IEnumerable<ProjectResponseDto>> GetAllAsync(int userId, string role)
    {
        return await db.Projects
            .Include(p => p.ProjectManager)
            .Include(p => p.SiteEngineer)
            .Include(p => p.Phases)
            .Select(p => ToDto(p))
            .ToListAsync();
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

    public async Task<ProjectResponseDto> CreateAsync(ProjectCreateDto dto, int createdByUserId, string createdByRole)
    {
        var status = string.IsNullOrWhiteSpace(dto.Status) ? ProjectStatus.Planning : Enum.Parse<ProjectStatus>(dto.Status);
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
            // ProjectManagerId isn't nullable, so whoever creates the project
            // always fills it — same as it's always been for Admin (who
            // isn't a "real" ProjectManager either). A SiteEngineer creating
            // their own project additionally becomes its SiteEngineerId,
            // which is what IProjectAccessService's ownership check actually
            // reads — that's what makes it "their" project to edit.
            ProjectManagerId   = createdByUserId,
            SiteEngineerId     = createdByRole == "SiteEngineer" ? createdByUserId : dto.SiteEngineerId,
            Status             = status,
            IsHistorical       = dto.IsHistorical,
            // Backfilled via "Add Completed Project" (IsHistorical) or created
            // directly as Completed — either way it's done, and Progress
            // otherwise only ever advances through LogProgressAsync's
            // Progress Tracker, which a backfilled project never goes through.
            Progress           = dto.IsHistorical || status == ProjectStatus.Completed ? 100 : 0,
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

        await GeocodeAndSaveAsync(project);
        return (await GetByIdAsync(project.Id))!;
    }

    // Best-effort — a geocoding failure never blocks the project save that
    // already happened above; the project just stays outside weather coverage.
    private async Task GeocodeAndSaveAsync(Project project)
    {
        var coords = await geocoding.GeocodeAsync(project.Location);
        if (coords is null) return;
        project.Latitude  = coords.Value.Latitude;
        project.Longitude = coords.Value.Longitude;
        await db.SaveChangesAsync();
    }

    public async Task<ProjectResponseDto?> UpdateAsync(int id, ProjectCreateDto dto)
    {
        var project = await db.Projects.Include(p => p.Phases).FirstOrDefaultAsync(p => p.Id == id);
        if (project is null) return null;

        var locationChanged = !string.Equals(project.Location, dto.Location, StringComparison.Ordinal);

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
        {
            project.Status = Enum.Parse<ProjectStatus>(dto.Status);
            // Same rule as CreateAsync — a project marked Completed here
            // (e.g. via Edit Project Details) is done, regardless of what
            // its Progress Tracker value happened to be.
            if (project.Status == ProjectStatus.Completed)
                project.Progress = 100;
        }
        project.UpdatedAt          = DateTime.UtcNow;

        await db.SaveChangesAsync();
        if (locationChanged) await GeocodeAndSaveAsync(project);
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
            var wasAlreadyCompleted = project.Status == ProjectStatus.Completed;
            project.Status = ProjectStatus.Completed;
            project.IsHistorical = true;

            // A BOQ row with no Excess/Waste record against it has
            // ActualQuantity stuck at its creation-time default of 0 (see
            // BOQItem.ActualQuantity) — that's "never checked", not "verified
            // zero used". Now that the project is actually finished, silence
            // is the best signal available: assume the estimate was consumed
            // as planned. Rows that DO have a logged record are left alone —
            // their ActualQuantity already reflects a real baseline-minus-
            // logged calculation (see ExcessWasteService), which may
            // legitimately be 0. Only runs on the actual transition into
            // Completed, not on every later progress update still at 100.
            if (!wasAlreadyCompleted)
            {
                var boqItems = await db.BOQItems.Where(b => b.ProjectId == projectId).ToListAsync();
                var boqItemIds = boqItems.Select(b => b.Id).ToList();
                var loggedBoqItemIds = await db.ExcessWasteRecords
                    .Where(e => e.BOQItemId != null && boqItemIds.Contains(e.BOQItemId.Value))
                    .Select(e => e.BOQItemId!.Value)
                    .Distinct()
                    .ToListAsync();
                var loggedSet = loggedBoqItemIds.ToHashSet();
                foreach (var b in boqItems)
                {
                    if (!loggedSet.Contains(b.Id))
                    {
                        b.ActualQuantity = b.EstimatedPurchaseQuantity ?? b.EstimatedQuantity;
                        // Nobody ever confirmed this — the estimate is just
                        // standing in because silence is the best signal
                        // available. Flagged, not presented as observed data;
                        // see BOQItem.IsUsageConfirmed.
                        b.IsUsageConfirmed = false;
                    }
                }
            }
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
