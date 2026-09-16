using ConstructIQ.API.Models.DTOs.Auth;

namespace ConstructIQ.API.Services.Interfaces;

public interface IAuthService
{
    Task<LoginResponseDto?> LoginAsync(LoginRequestDto request);
    Task<LoginResponseDto?> GoogleLoginAsync(GoogleLoginRequestDto request);
    Task ForgotPasswordAsync(ForgotPasswordRequestDto request);
    Task<bool> ResetPasswordAsync(ResetPasswordRequestDto request);
}
