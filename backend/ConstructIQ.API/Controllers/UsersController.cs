using System.Security.Claims;
using ConstructIQ.API.Data;
using ConstructIQ.API.Helpers;
using ConstructIQ.API.Models.DTOs.Auth;
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
        var users = await db.Users.Select(u => new UserDto
        {
            Id        = u.Id,
            Username  = u.Username,
            Email     = u.Email,
            FirstName = u.FirstName,
            LastName  = u.LastName,
            Role      = u.Role.ToString(),
            IsActive  = u.IsActive,
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
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return Ok(new UserDto
        {
            Id        = user.Id,
            Username  = user.Username,
            Email     = user.Email,
            FirstName = user.FirstName,
            LastName  = user.LastName,
            Role      = user.Role.ToString(),
            IsActive  = user.IsActive,
        });
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
            Id        = user.Id,
            Username  = user.Username,
            Email     = user.Email,
            FirstName = user.FirstName,
            LastName  = user.LastName,
            Role      = user.Role.ToString(),
            IsActive  = user.IsActive,
        });
    }
}

public record CreateUserDto(string Username, string Email, string Password, string FirstName, string LastName, string Role);
public record UpdateStatusDto(bool IsActive);
