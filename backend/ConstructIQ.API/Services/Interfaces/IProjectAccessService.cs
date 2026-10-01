namespace ConstructIQ.API.Services.Interfaces;

// Centralizes the one ownership rule layered on top of the role checks
// already on each controller action: Admin/ProjectManager can edit any
// project, but a SiteEngineer can only edit a project they're the assigned
// SiteEngineer on — not one belonging to a different SiteEngineer. Every
// write endpoint under a project (BOQ, Documents, Measurements, Phases,
// the project itself) shares this same rule, so it lives in one place
// instead of being re-derived per controller.
public interface IProjectAccessService
{
    Task<bool> CanEditProjectAsync(int projectId, int userId, string role);
    Task<bool> CanEditBoqItemAsync(int boqItemId, int userId, string role);
    Task<bool> CanEditDocumentAsync(int documentId, int userId, string role);
    Task<bool> CanEditPhaseAsync(int phaseId, int userId, string role);
}
