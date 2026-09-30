using ConstructIQ.API.Data;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class ProjectAccessService(AppDbContext db) : IProjectAccessService
{
    public async Task<bool> CanEditProjectAsync(int projectId, int userId, string role)
    {
        if (role is "Admin" or "ProjectManager") return true;
        if (role != "SiteEngineer") return false;

        var siteEngineerId = await db.Projects
            .Where(p => p.Id == projectId)
            .Select(p => (int?)p.SiteEngineerId)
            .FirstOrDefaultAsync();
        return siteEngineerId == userId;
    }

    public async Task<bool> CanEditBoqItemAsync(int boqItemId, int userId, string role)
    {
        var projectId = await db.BOQItems
            .Where(b => b.Id == boqItemId)
            .Select(b => (int?)b.ProjectId)
            .FirstOrDefaultAsync();
        return projectId is not null && await CanEditProjectAsync(projectId.Value, userId, role);
    }

    public async Task<bool> CanEditDocumentAsync(int documentId, int userId, string role)
    {
        var projectId = await db.ProjectDocuments
            .Where(d => d.Id == documentId)
            .Select(d => (int?)d.ProjectId)
            .FirstOrDefaultAsync();
        return projectId is not null && await CanEditProjectAsync(projectId.Value, userId, role);
    }

    public async Task<bool> CanEditPhaseAsync(int phaseId, int userId, string role)
    {
        var projectId = await db.Phases
            .Where(p => p.Id == phaseId)
            .Select(p => (int?)p.ProjectId)
            .FirstOrDefaultAsync();
        return projectId is not null && await CanEditProjectAsync(projectId.Value, userId, role);
    }
}
