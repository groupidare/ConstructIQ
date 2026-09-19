using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Auth;

public class LoginRequestDto
{
    [Required] public string Username { get; set; } = string.Empty;
    [Required] public string Password { get; set; } = string.Empty;

    // A stable per-browser id the frontend generates and persists in localStorage —
    // not a session/auth token. Lets the server recognize "this device has
    // already passed a code challenge" without any cross-origin cookie.
    public string? DeviceId { get; set; }
}
