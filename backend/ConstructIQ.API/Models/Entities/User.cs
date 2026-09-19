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

    [MaxLength(255)]
    public string? AvatarUrl { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLogin  { get; set; }

    [MaxLength(128)]
    public string? PasswordResetToken { get; set; }
    public DateTime? PasswordResetTokenExpiresAt { get; set; }

    public bool MfaEnabled { get; set; } = false;

    [MaxLength(10)]
    public string? MfaCode { get; set; }
    public DateTime? MfaCodeExpiresAt { get; set; }

    [MaxLength(64)]
    public string? MfaChallengeToken { get; set; }

    // Set while an email-code challenge is outstanding for a device that
    // isn't trusted yet; cleared (and the device recorded as trusted) once
    // the code is verified. Null challenges — e.g. an already-trusted device
    // re-verifying because MfaEnabled is on — never touch this.
    [MaxLength(128)]
    public string? PendingDeviceId { get; set; }

    public ICollection<Project> ManagedProjects { get; set; } = [];
    public ICollection<ActivityLog> ActivityLogs { get; set; } = [];
    public ICollection<TrustedDevice> TrustedDevices { get; set; } = [];
}
