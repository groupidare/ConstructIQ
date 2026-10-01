using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Auth;

public class GoogleLoginRequestDto
{
    [Required] public string IdToken { get; set; } = string.Empty;

    // The role the user picked on the login screen. Checked against the
    // account's actual assigned role before any MFA code is sent.
    public string? Role { get; set; }
    public string? DeviceId { get; set; }
}
