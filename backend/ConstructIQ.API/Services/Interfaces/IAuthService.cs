using ConstructIQ.API.Models.DTOs.Auth;

namespace ConstructIQ.API.Services.Interfaces;

public interface IAuthService
{
    Task<LoginResponseDto?> LoginAsync(LoginRequestDto request);
}
