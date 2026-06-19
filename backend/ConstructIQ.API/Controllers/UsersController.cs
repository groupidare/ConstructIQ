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
public class UsersController(AppDbContext db) : ControllerBase
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
            CreatedAt    = user.CreatedAt,
            LastLogin    = user.LastLogin,
            ProjectCount = 0,
        });
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
