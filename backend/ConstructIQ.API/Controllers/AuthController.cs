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

    [HttpPost("google")]
    public async Task<IActionResult> GoogleLogin([FromBody] GoogleLoginRequestDto request)
    {
        var result = await authService.GoogleLoginAsync(request);
        if (result is null)
            return Unauthorized(new { message = "No ConstructIQ account is registered for this Google email. Contact your administrator." });
        return Ok(result);
    }

    [HttpPost("mfa/verify")]
    public async Task<IActionResult> VerifyMfa([FromBody] VerifyMfaRequestDto request)
    {
        var result = await authService.VerifyMfaAsync(request);
        if (result is null) return BadRequest(new { message = "Invalid or expired code." });
        return Ok(result);
    }

    [HttpPost("mfa/resend")]
    public async Task<IActionResult> ResendMfaCode([FromBody] ResendMfaRequestDto request)
    {
        var success = await authService.ResendMfaCodeAsync(request);
        if (!success) return BadRequest(new { message = "This verification session has expired. Please sign in again." });
        return Ok(new { message = "Code resent." });
    }

    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordRequestDto request)
    {
        await authService.ForgotPasswordAsync(request);
        // Same response whether or not the email exists on an account.
        return Ok(new { message = "If that email is registered, a reset link has been sent." });
    }

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword([FromBody] ResetPasswordRequestDto request)
    {
        var success = await authService.ResetPasswordAsync(request);
        if (!success) return BadRequest(new { message = "This reset link is invalid or has expired." });
        return Ok(new { message = "Password reset successfully." });
    }
}
