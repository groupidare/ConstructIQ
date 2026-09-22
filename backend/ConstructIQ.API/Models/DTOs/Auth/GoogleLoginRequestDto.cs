using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Auth;

public class GoogleLoginRequestDto
{
    [Required] public string IdToken { get; set; } = string.Empty;
    public string? DeviceId { get; set; }
}
