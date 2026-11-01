using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

// A browser/device that has already completed one email-code challenge for a
// user. Recorded only after a successful verification, so a stolen password
// alone still can't sign in silently from an unrecognized device.
public class TrustedDevice
{
    public int Id { get; set; }

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    [Required, MaxLength(128)]
    public string DeviceId { get; set; } = string.Empty;

    [MaxLength(255)]
    public string? UserAgent { get; set; }

    public DateTime CreatedAt  { get; set; } = DateTime.UtcNow;
    public DateTime LastUsedAt { get; set; } = DateTime.UtcNow;
}
