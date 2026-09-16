using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Auth;

public class ForgotPasswordRequestDto
{
    [Required, EmailAddress] public string Email { get; set; } = string.Empty;
}

public class ResetPasswordRequestDto
{
    [Required] public string Token { get; set; } = string.Empty;
    [Required, MinLength(8)] public string NewPassword { get; set; } = string.Empty;
}
