using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

public enum UserRole
{
    Admin,
    ProjectManager,
    SiteEngineer,
    WarehousePersonnel,
    ProcurementOfficer
}

public class User
{
    public int Id { get; set; }

    [Required, MaxLength(100)]
    public string Username { get; set; } = string.Empty;

    [Required, MaxLength(255)]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string PasswordHash { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string FirstName { get; set; } = string.Empty;

    [Required, MaxLength(100)]
    public string LastName { get; set; } = string.Empty;

    public UserRole Role { get; set; } = UserRole.SiteEngineer;

    [MaxLength(30)]
    public string? PhoneNumber { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLogin  { get; set; }

    public ICollection<Project> ManagedProjects { get; set; } = [];
    public ICollection<ActivityLog> ActivityLogs { get; set; } = [];
}
