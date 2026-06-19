using ConstructIQ.API.Data;
using ConstructIQ.API.Helpers;
using ConstructIQ.API.Models.DTOs.Auth;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class AuthService(AppDbContext db, IConfiguration config) : IAuthService
{
    public async Task<LoginResponseDto?> LoginAsync(LoginRequestDto request)
    {
        var user = await db.Users
            .FirstOrDefaultAsync(u =>
                (u.Username == request.Username || u.Email == request.Username) && u.IsActive);

        if (user is null || !PasswordHasher.Verify(request.Password, user.PasswordHash))
            return null;

        var token     = JwtHelper.GenerateToken(user, config);
        var expiresAt = DateTime.UtcNow.AddHours(
            int.TryParse(config["JWT_EXPIRES_HOURS"], out var h) ? h : 24);

        return new LoginResponseDto
        {
            Token     = token,
            ExpiresAt = expiresAt,
            User = new UserDto
            {
                Id        = user.Id,
                Username  = user.Username,
                Email     = user.Email,
                FirstName = user.FirstName,
                LastName  = user.LastName,
                Role      = user.Role.ToString(),
                IsActive  = user.IsActive,
            }
        };
    }
}
