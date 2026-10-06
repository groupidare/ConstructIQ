using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using ConstructIQ.API.Data;
using ConstructIQ.API.Helpers;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace ConstructIQ.API.Controllers;

[ApiController, Authorize, Route("api/v1/auth")]
public class AccountSecurityController(AppDbContext db, IConfiguration config, IEmailService email,
    ILogger<AccountSecurityController> logger) : ControllerBase
{
    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private byte[] Key => Encoding.UTF8.GetBytes(config["JWT_SECRET"]!);
    private string OtpHash(int id, string code) => Convert.ToHexString(
        HMACSHA256.HashData(Key, Encoding.UTF8.GetBytes($"password-change:{id}:{code}")));

    private Task<User> LockUser() => db.Users.FromSqlInterpolated(
        $"SELECT * FROM Users WHERE Id = {UserId} FOR UPDATE").SingleAsync();

    private void Audit(string action) => db.ActivityLogs.Add(new ActivityLog
    {
        UserId = UserId, Action = action, EntityType = "User", EntityId = UserId,
        IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
    });

    [HttpPost("change-password/request-otp")]
    public async Task<IActionResult> RequestOtp()
    {
        var code = RandomNumberGenerator.GetInt32(1_000_000).ToString("D6");
        string address = string.Empty;
        var hash = OtpHash(UserId, code);
        var rateLimitResponse = await db.Database.CreateExecutionStrategy().ExecuteAsync<IActionResult?>(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            var user = await LockUser();
            if (user.PasswordChangeRequestedAt > DateTime.UtcNow.AddMinutes(-1))
                return StatusCode(429, new { message = "Wait one minute before requesting another code." });
            address = user.Email;
            user.PasswordChangeRequestedAt = DateTime.UtcNow;
            user.PasswordChangeExpiresAt = DateTime.UtcNow.AddMinutes(5);
            user.PasswordChangeOtpHash = hash;
            user.PasswordChangeTokenId = null;
            user.PasswordChangeAttempts = 0;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return (IActionResult?)null;
        });
        if (rateLimitResponse is not null) return rateLimitResponse;
        try { await email.SendPasswordChangeCodeAsync(address, code); }
        catch (Exception ex)
        {
            logger.LogError(ex, "Password change email delivery failed for user {UserId}", UserId);
            await db.Users.Where(u => u.Id == UserId && u.PasswordChangeOtpHash == hash)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.PasswordChangeOtpHash, (string?)null));
            return StatusCode(503, new { message = "Verification email could not be sent. Try again later." });
        }
        Audit("PASSWORD_CHANGE_OTP_SENT");
        await db.SaveChangesAsync();
        return Ok(new { message = "Verification code sent to your registered email.", expiresInSeconds = 300 });
    }

    [HttpPost("change-password/verify-otp")]
    public async Task<IActionResult> VerifyOtp(VerifyPasswordChangeOtp dto)
    {
        return await db.Database.CreateExecutionStrategy().ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            var user = await LockUser();
            if (user.PasswordChangeOtpHash is null || user.PasswordChangeExpiresAt <= DateTime.UtcNow || user.PasswordChangeAttempts >= 5)
                return BadRequest(new { message = "The code expired or is unavailable. Request another code." });
            user.PasswordChangeAttempts++;
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(user.PasswordChangeOtpHash),
                    Convert.FromHexString(OtpHash(UserId, dto.Code))))
            {
                if (user.PasswordChangeAttempts >= 5) user.PasswordChangeOtpHash = null;
                Audit("PASSWORD_CHANGE_OTP_REJECTED");
                await db.SaveChangesAsync();
                await tx.CommitAsync();
                return BadRequest(new { message = "Invalid verification code." });
            }
            var expires = DateTime.UtcNow.AddMinutes(5);
            user.PasswordChangeOtpHash = null;
            user.PasswordChangeTokenId = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            user.PasswordChangeExpiresAt = expires;
            var token = new JwtSecurityToken(config["JWT_ISSUER"], "ConstructIQ.PasswordChange",
                [new Claim(JwtRegisteredClaimNames.Sub, UserId.ToString()),
                 new Claim(JwtRegisteredClaimNames.Jti, user.PasswordChangeTokenId),
                 new Claim("purpose", "password_change")],
                notBefore: DateTime.UtcNow, expires: expires,
                signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Key), SecurityAlgorithms.HmacSha256));
            Audit("PASSWORD_CHANGE_VERIFIED");
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(new { password_change_token = new JwtSecurityTokenHandler().WriteToken(token), expiresAt = expires });
        });
    }

    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest dto)
    {
        if (dto.NewPassword != dto.ConfirmPassword || Encoding.UTF8.GetByteCount(dto.NewPassword) > 72)
            return BadRequest(new { message = "Passwords must match and contain at most 72 UTF-8 bytes." });
        ClaimsPrincipal claims;
        try
        {
            claims = new JwtSecurityTokenHandler { MapInboundClaims = false }.ValidateToken(dto.PasswordChangeToken,
                new TokenValidationParameters
                {
                    ValidateIssuer = true, ValidIssuer = config["JWT_ISSUER"],
                    ValidateAudience = true, ValidAudience = "ConstructIQ.PasswordChange",
                    ValidateLifetime = true, RequireExpirationTime = true, ClockSkew = TimeSpan.Zero,
                    ValidateIssuerSigningKey = true, IssuerSigningKey = new SymmetricSecurityKey(Key),
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                }, out _);
        }
        catch (Exception ex) when (ex is SecurityTokenException or ArgumentException)
        { return BadRequest(new { message = "Verification expired or is invalid. Verify your email again." }); }
        if (claims.FindFirstValue("sub") != UserId.ToString() || claims.FindFirstValue("purpose") != "password_change")
            return BadRequest(new { message = "Invalid password change authorization." });

        return await db.Database.CreateExecutionStrategy().ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            var user = await LockUser();
            if (user.PasswordChangeTokenId is null || user.PasswordChangeTokenId != claims.FindFirstValue("jti") ||
                user.PasswordChangeExpiresAt <= DateTime.UtcNow)
                return BadRequest(new { message = "Authorization expired or was already used. Verify your email again." });
            user.PasswordHash = PasswordHasher.Hash(dto.NewPassword);
            user.PasswordChangeTokenId = null;
            user.PasswordChangeOtpHash = null;
            user.PasswordChangeExpiresAt = null;
            user.PasswordResetToken = null;
            user.PasswordResetTokenExpiresAt = null;
            user.MfaChallengeToken = null;
            user.MfaCode = null;
            user.MfaCodeExpiresAt = null;
            user.PendingDeviceId = null;
            user.SecurityStamp = Guid.NewGuid().ToString("N");
            user.UpdatedAt = DateTime.UtcNow;
            await db.TrustedDevices.Where(d => d.UserId == UserId).ExecuteDeleteAsync();
            Audit("PASSWORD_CHANGED");
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(new { message = "Password changed. Sign in again." });
        });
    }

    [HttpGet("mfa")]
    public async Task<IActionResult> MfaStatus() => Ok(new
    { isMfaEnabled = await db.Users.Where(u => u.Id == UserId).Select(u => u.MfaEnabled).SingleAsync(), method = "email" });

    [HttpPost("mfa/enable")]
    public Task<IActionResult> EnableMfa() => SetMfa(true);
    [HttpPost("mfa/disable")]
    public Task<IActionResult> DisableMfa() => SetMfa(false);

    private async Task<IActionResult> SetMfa(bool enabled)
    {
        return await db.Database.CreateExecutionStrategy().ExecuteAsync<IActionResult>(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync();
            var user = await LockUser();
            user.MfaEnabled = enabled;
            user.MfaCode = null;
            user.MfaCodeExpiresAt = null;
            user.MfaChallengeToken = null;
            user.PendingDeviceId = null;
            user.UpdatedAt = DateTime.UtcNow;
            Audit(enabled ? "MFA_ENABLED" : "MFA_DISABLED");
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Ok(new { isMfaEnabled = user.MfaEnabled, method = "email" });
        });
    }
}

public record VerifyPasswordChangeOtp([Required, RegularExpression(@"^\d{6}$")] string Code);
public record ChangePasswordRequest(
    [Required, MaxLength(4096)] string PasswordChangeToken,
    [Required, MinLength(8), MaxLength(72)] string NewPassword,
    [Required] string ConfirmPassword);
