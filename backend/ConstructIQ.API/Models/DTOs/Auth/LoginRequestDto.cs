using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Auth;

public class LoginRequestDto
{
    [Required] public string Username { get; set; } = string.Empty;
    [Required] public string Password { get; set; } = string.Empty;

    // The role the user picked on the login screen. Checked against the
    // account's actual assigned role before any MFA code is sent — a
    // mismatch must fail immediately, not after an email round-trip.
    public string? Role { get; set; }

    // A stable per-browser id the frontend generates and persists in localStorage —
    // not a session/auth token. Lets the server recognize "this device has
    // already passed a code challenge" without any cross-origin cookie.
    public string? DeviceId { get; set; }
}
