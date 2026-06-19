using ConstructIQ.API.Models.DTOs.Auth;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(IAuthService authService) : ControllerBase
{
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequestDto request)
    {
        var result = await authService.LoginAsync(request);
        if (result is null) return Unauthorized(new { message = "Invalid username or password." });
        return Ok(result);
    }
}
