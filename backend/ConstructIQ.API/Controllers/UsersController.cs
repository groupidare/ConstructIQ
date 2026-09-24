using System.Security.Claims;
using ConstructIQ.API.Data;
using ConstructIQ.API.Helpers;
using ConstructIQ.API.Models.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UsersController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    [HttpGet]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetAll()
    {
        var users = await db.Users
            .Include(u => u.ManagedProjects)
            .Select(u => new UserDto
            {
                Id           = u.Id,
                Username     = u.Username,
                Email        = u.Email,
                FirstName    = u.FirstName,
                LastName     = u.LastName,
                Role         = u.Role.ToString(),
                IsActive     = u.IsActive,
                PhoneNumber  = u.PhoneNumber,
                AvatarUrl    = u.AvatarUrl,
                MfaEnabled   = u.MfaEnabled,
                CreatedAt    = u.CreatedAt,
                LastLogin    = u.LastLogin,
                ProjectCount = u.ManagedProjects.Count,
            }).ToListAsync();

        return Ok(users);
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] CreateUserDto dto)
    {
        if (await db.Users.AnyAsync(u => u.Username == dto.Username))
            return Conflict(new { message = "Username already taken." });

        var user = new User
        {
            Username     = dto.Username,
            Email        = dto.Email,
            PasswordHash = PasswordHasher.Hash(dto.Password),
            FirstName    = dto.FirstName,
            LastName     = dto.LastName,
            Role         = Enum.Parse<UserRole>(dto.Role),
            PhoneNumber  = dto.PhoneNumber,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return Ok(new UserDto
        {
            Id           = user.Id,
            Username     = user.Username,
            Email        = user.Email,
            FirstName    = user.FirstName,
            LastName     = user.LastName,
            Role         = user.Role.ToString(),
            IsActive     = user.IsActive,
            PhoneNumber  = user.PhoneNumber,
            AvatarUrl    = user.AvatarUrl,
            MfaEnabled   = user.MfaEnabled,
            CreatedAt    = user.CreatedAt,
            LastLogin    = user.LastLogin,
            ProjectCount = 0,
        });
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateUserDto dto)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();

        user.FirstName   = dto.FirstName;
        user.LastName    = dto.LastName;
        user.Email       = dto.Email;
        user.PhoneNumber = dto.PhoneNumber;
        user.Role        = Enum.Parse<UserRole>(dto.Role);
        user.IsActive    = dto.IsActive;
        user.UpdatedAt   = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(dto.Password))
            user.PasswordHash = PasswordHasher.Hash(dto.Password);

        await db.SaveChangesAsync();
        return Ok(new { message = "User updated." });
    }

    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> UpdateStatus(int id, [FromBody] UpdateStatusDto dto)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();

        user.IsActive  = dto.IsActive;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(new { message = "Status updated." });
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();

        db.Users.Remove(user);
        await db.SaveChangesAsync();
        return Ok(new { message = "User deleted." });
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                   ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(idClaim, out var userId))
            return Unauthorized();

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        return Ok(new UserDto
        {
            Id           = user.Id,
            Username     = user.Username,
            Email        = user.Email,
            FirstName    = user.FirstName,
            LastName     = user.LastName,
            Role         = user.Role.ToString(),
            IsActive     = user.IsActive,
            PhoneNumber  = user.PhoneNumber,
            AvatarUrl    = user.AvatarUrl,
            MfaEnabled   = user.MfaEnabled,
            CreatedAt    = user.CreatedAt,
            LastLogin    = user.LastLogin,
            ProjectCount = 0,
        });
    }

    // Self-service profile edit. Deliberately separate from Update(int id) above:
    // that one is Admin-only and accepts Role/IsActive, which a user must never
    // be able to set on themselves.
    [HttpPut("me")]
    public async Task<IActionResult> UpdateMe([FromBody] UpdateProfileDto dto)
    {
        var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                   ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(idClaim, out var userId))
            return Unauthorized();

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        if (string.IsNullOrWhiteSpace(dto.FirstName) || string.IsNullOrWhiteSpace(dto.LastName))
            return BadRequest(new { message = "First name and last name are required." });

        // Email is intentionally not user-editable here — it's the account's
        // login identity, so changing it goes through an admin, not self-service.
        user.FirstName   = dto.FirstName.Trim();
        user.LastName    = dto.LastName.Trim();
        user.PhoneNumber = dto.PhoneNumber;
        user.UpdatedAt   = DateTime.UtcNow;

        await db.SaveChangesAsync();

        return Ok(new UserDto
        {
            Id           = user.Id,
            Username     = user.Username,
            Email        = user.Email,
            FirstName    = user.FirstName,
            LastName     = user.LastName,
            Role         = user.Role.ToString(),
            IsActive     = user.IsActive,
            PhoneNumber  = user.PhoneNumber,
            AvatarUrl    = user.AvatarUrl,
            MfaEnabled   = user.MfaEnabled,
            CreatedAt    = user.CreatedAt,
            LastLogin    = user.LastLogin,
            ProjectCount = 0,
        });
    }

    // Toggles the caller's own MFA setting. Enabling takes effect immediately —
    // no separate verification step — matching the rest of Settings' toggles;
    // the emailed code only comes into play on the next login.
    [HttpPut("me/mfa")]
    public async Task<IActionResult> UpdateMyMfa([FromBody] UpdateMfaDto dto)
    {
        var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                   ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(idClaim, out var userId))
            return Unauthorized();

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        user.MfaEnabled        = dto.Enabled;
        user.MfaCode           = null;
        user.MfaCodeExpiresAt  = null;
        user.MfaChallengeToken = null;
        user.UpdatedAt         = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Ok(new UserDto
        {
            Id           = user.Id,
            Username     = user.Username,
            Email        = user.Email,
            FirstName    = user.FirstName,
            LastName     = user.LastName,
            Role         = user.Role.ToString(),
            IsActive     = user.IsActive,
            PhoneNumber  = user.PhoneNumber,
            AvatarUrl    = user.AvatarUrl,
            MfaEnabled   = user.MfaEnabled,
            CreatedAt    = user.CreatedAt,
            LastLogin    = user.LastLogin,
            ProjectCount = 0,
        });
    }

    private static readonly Dictionary<string, string> AllowedAvatarTypes = new()
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"]  = ".png",
        ["image/webp"] = ".webp",
    };
    private const long MaxAvatarBytes = 5 * 1024 * 1024; // 5 MB

    [HttpPost("me/avatar")]
    public async Task<IActionResult> UploadMyAvatar(IFormFile file)
    {
        var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                   ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(idClaim, out var userId))
            return Unauthorized();

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        if (file is null || file.Length == 0)
            return BadRequest(new { message = "No file uploaded." });

        if (file.Length > MaxAvatarBytes)
            return BadRequest(new { message = "Image must be 5MB or smaller." });

        if (!AllowedAvatarTypes.TryGetValue(file.ContentType, out var ext))
            return BadRequest(new { message = "Only JPEG, PNG, or WebP images are allowed." });

        var avatarsDir = Path.Combine(env.WebRootPath, "uploads", "avatars");
        Directory.CreateDirectory(avatarsDir);

        // Delete the previous avatar file (if any) so uploads don't accumulate.
        if (!string.IsNullOrWhiteSpace(user.AvatarUrl))
        {
            var oldPath = Path.Combine(env.WebRootPath, user.AvatarUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
            if (System.IO.File.Exists(oldPath))
            {
                try { System.IO.File.Delete(oldPath); } catch { /* best-effort cleanup */ }
            }
        }

        var fileName = $"{userId}_{Guid.NewGuid():N}{ext}";
        var savePath = Path.Combine(avatarsDir, fileName);
        await using (var stream = System.IO.File.Create(savePath))
            await file.CopyToAsync(stream);

        user.AvatarUrl = $"/uploads/avatars/{fileName}";
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Ok(new UserDto
        {
            Id           = user.Id,
            Username     = user.Username,
            Email        = user.Email,
            FirstName    = user.FirstName,
            LastName     = user.LastName,
            Role         = user.Role.ToString(),
            IsActive     = user.IsActive,
            PhoneNumber  = user.PhoneNumber,
            AvatarUrl    = user.AvatarUrl,
            MfaEnabled   = user.MfaEnabled,
            CreatedAt    = user.CreatedAt,
            LastLogin    = user.LastLogin,
            ProjectCount = 0,
        });
    }

    [HttpDelete("me/avatar")]
    public async Task<IActionResult> DeleteMyAvatar()
    {
        var idClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                   ?? User.FindFirst("sub")?.Value;
        if (!int.TryParse(idClaim, out var userId))
            return Unauthorized();

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        if (!string.IsNullOrWhiteSpace(user.AvatarUrl))
        {
            var oldPath = Path.Combine(env.WebRootPath, user.AvatarUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
            if (System.IO.File.Exists(oldPath))
            {
                try { System.IO.File.Delete(oldPath); } catch { /* best-effort cleanup */ }
            }
        }

        user.AvatarUrl = null;
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Ok(new { message = "Avatar removed." });
    }
}

public record UserDto
{
    public int      Id           { get; init; }
    public string   Username     { get; init; } = "";
    public string   Email        { get; init; } = "";
    public string   FirstName    { get; init; } = "";
    public string   LastName     { get; init; } = "";
    public string   Role         { get; init; } = "";
    public bool     IsActive     { get; init; }
    public string?  PhoneNumber  { get; init; }
    public string?  AvatarUrl    { get; init; }
    public bool     MfaEnabled   { get; init; }
    public DateTime CreatedAt    { get; init; }
    public DateTime? LastLogin   { get; init; }
    public int      ProjectCount { get; init; }
}

public record CreateUserDto(
    string Username,
    string Email,
    string Password,
    string FirstName,
    string LastName,
    string Role,
    string? PhoneNumber = null
);

public record UpdateUserDto(
    string FirstName,
    string LastName,
    string Email,
    string Role,
    bool   IsActive,
    string? PhoneNumber = null,
    string? Password    = null
);

public record UpdateStatusDto(bool IsActive);

public record UpdateMfaDto(bool Enabled);

public record UpdateProfileDto(
    string FirstName,
    string LastName,
    string? PhoneNumber = null
);
