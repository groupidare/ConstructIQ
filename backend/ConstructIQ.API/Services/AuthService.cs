using System.Security.Cryptography;
using ConstructIQ.API.Data;
using ConstructIQ.API.Helpers;
using ConstructIQ.API.Models.DTOs.Auth;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Google.Apis.Auth;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class AuthService(
    AppDbContext db,
    IConfiguration config,
    IEmailService emailService,
    IHttpContextAccessor httpContextAccessor,
    ILogger<AuthService> logger) : IAuthService
{
    public async Task<LoginResponseDto?> LoginAsync(LoginRequestDto request)
    {
        var user = await db.Users
            .FirstOrDefaultAsync(u =>
                (u.Username == request.Username || u.Email == request.Username) && u.IsActive);

        if (user is null || !PasswordHasher.Verify(request.Password, user.PasswordHash))
            return null;

        var deviceTrusted = await IsDeviceTrustedAsync(user.Id, request.DeviceId);
        if (user.MfaEnabled || !deviceTrusted)
            return await IssueMfaChallengeAsync(user, deviceTrusted ? null : request.DeviceId);

        return await BuildLoginResponse(user);
    }

    public async Task<LoginResponseDto?> GoogleLoginAsync(GoogleLoginRequestDto request)
    {
        var clientId = config["GOOGLE_CLIENT_ID"];
        if (string.IsNullOrWhiteSpace(clientId))
        {
            logger.LogError("GOOGLE_CLIENT_ID is not configured — cannot verify Google sign-in.");
            return null;
        }

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(request.IdToken, new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = [clientId],
            });
        }
        catch (InvalidJwtException ex)
        {
            logger.LogWarning(ex, "Rejected an invalid Google ID token.");
            return null;
        }

        // Google verifies the email itself for accounts created directly with Google;
        // reject the rare case where it hasn't (e.g. some enterprise-federated accounts).
        if (!payload.EmailVerified) return null;

        // Deliberately no auto-provisioning here: only an email an administrator has
        // already registered as a User can sign in this way — Google is an alternate
        // credential for an existing account, not a self-registration path.
        var user = await db.Users.FirstOrDefaultAsync(u =>
            u.Email.ToLower() == payload.Email.ToLower() && u.IsActive);

        if (user is null) return null;

        var deviceTrusted = await IsDeviceTrustedAsync(user.Id, request.DeviceId);
        if (user.MfaEnabled || !deviceTrusted)
            return await IssueMfaChallengeAsync(user, deviceTrusted ? null : request.DeviceId);

        return await BuildLoginResponse(user);
    }

    public async Task<LoginResponseDto?> VerifyMfaAsync(VerifyMfaRequestDto request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u =>
            u.MfaChallengeToken == request.ChallengeToken
            && u.MfaCodeExpiresAt != null
            && u.MfaCodeExpiresAt > DateTime.UtcNow);

        if (user is null || user.MfaCode != request.Code.Trim())
            return null;

        // A pending device id means this challenge exists (at least in part)
        // because the device wasn't recognized yet — passing the code proves
        // it now, so it's remembered and won't be challenged again purely for
        // being unrecognized (an always-on MfaEnabled account still will be).
        if (!string.IsNullOrEmpty(user.PendingDeviceId))
            await TrustDeviceAsync(user, user.PendingDeviceId);

        user.MfaCode           = null;
        user.MfaCodeExpiresAt  = null;
        user.MfaChallengeToken = null;
        user.PendingDeviceId   = null;

        return await BuildLoginResponse(user);
    }

    public async Task<bool> ResendMfaCodeAsync(ResendMfaRequestDto request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.MfaChallengeToken == request.ChallengeToken);
        if (user is null) return false;

        await SendMfaCodeAsync(user, isNewDevice: !string.IsNullOrEmpty(user.PendingDeviceId));
        return true;
    }

    // A trusted device only ever needs re-verifying if the account has 2FA
    // permanently enabled; deviceId null here means "already trusted, no new
    // device to remember" and the challenge is purely the MfaEnabled case.
    private async Task<LoginResponseDto> IssueMfaChallengeAsync(User user, string? unrecognizedDeviceId)
    {
        user.MfaChallengeToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        user.PendingDeviceId   = unrecognizedDeviceId;
        await SendMfaCodeAsync(user, isNewDevice: unrecognizedDeviceId is not null);

        return new LoginResponseDto
        {
            MfaRequired    = true,
            ChallengeToken = user.MfaChallengeToken,
        };
    }

    private async Task SendMfaCodeAsync(User user, bool isNewDevice = false)
    {
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

        user.MfaCode          = code;
        user.MfaCodeExpiresAt = DateTime.UtcNow.AddMinutes(10);
        await db.SaveChangesAsync();

        try
        {
            await emailService.SendMfaCodeEmailAsync(user.Email, user.FirstName, code, isNewDevice);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to send MFA code email to {Email}.", user.Email);
        }
    }

    // Empty/absent deviceId (e.g. an older frontend build, or a browser with
    // localStorage disabled) is never treated as trusted — it always
    // challenges, which is the safe default.
    private async Task<bool> IsDeviceTrustedAsync(int userId, string? deviceId)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return false;

        var device = await db.TrustedDevices.FirstOrDefaultAsync(d => d.UserId == userId && d.DeviceId == deviceId);
        if (device is null) return false;

        device.LastUsedAt = DateTime.UtcNow; // persisted by the SaveChangesAsync inside BuildLoginResponse
        return true;
    }

    private async Task TrustDeviceAsync(User user, string deviceId)
    {
        var userAgent = httpContextAccessor.HttpContext?.Request.Headers.UserAgent.ToString();
        var existing = await db.TrustedDevices.FirstOrDefaultAsync(d => d.UserId == user.Id && d.DeviceId == deviceId);
        if (existing is null)
        {
            db.TrustedDevices.Add(new TrustedDevice
            {
                UserId    = user.Id,
                DeviceId  = deviceId,
                UserAgent = userAgent,
            });
        }
        else
        {
            existing.UserAgent  = userAgent;
            existing.LastUsedAt = DateTime.UtcNow;
        }
    }

    private async Task<LoginResponseDto> BuildLoginResponse(User user)
    {
        user.LastLogin = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var token     = JwtHelper.GenerateToken(user, config);
        var expiresAt = DateTime.UtcNow.AddHours(
            int.TryParse(config["JWT_EXPIRES_HOURS"], out var h) ? h : 24);

        return new LoginResponseDto
        {
            Token     = token,
            ExpiresAt = expiresAt,
            User = new UserDto
            {
                Id         = user.Id,
                Username   = user.Username,
                Email      = user.Email,
                FirstName  = user.FirstName,
                LastName   = user.LastName,
                Role       = user.Role.ToString(),
                IsActive   = user.IsActive,
                AvatarUrl  = user.AvatarUrl,
                MfaEnabled = user.MfaEnabled,
            }
        };
    }

    public async Task ForgotPasswordAsync(ForgotPasswordRequestDto request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == request.Email && u.IsActive);
        // Always behave the same whether the email exists or not — don't let this
        // endpoint be used to discover which addresses have accounts (OWASP A07).
        if (user is null) return;

        user.PasswordResetToken            = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        user.PasswordResetTokenExpiresAt   = DateTime.UtcNow.AddMinutes(30);
        await db.SaveChangesAsync();

        var frontendUrl = config["FRONTEND_URL"] ?? "http://localhost:3000";
        var resetLink   = $"{frontendUrl}/reset-password?token={user.PasswordResetToken}";

        try
        {
            await emailService.SendPasswordResetEmailAsync(user.Email, user.FirstName, resetLink);
        }
        catch (Exception ex)
        {
            // Swallow: the caller always gets a generic response regardless of email delivery.
            logger.LogError(ex, "Failed to send password reset email to {Email}.", user.Email);
        }
    }

    public async Task<bool> ResetPasswordAsync(ResetPasswordRequestDto request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u =>
            u.PasswordResetToken == request.Token
            && u.PasswordResetTokenExpiresAt != null
            && u.PasswordResetTokenExpiresAt > DateTime.UtcNow);

        if (user is null) return false;

        user.PasswordHash                 = PasswordHasher.Hash(request.NewPassword);
        user.PasswordResetToken           = null;
        user.PasswordResetTokenExpiresAt  = null;
        user.UpdatedAt                    = DateTime.UtcNow;

        await db.SaveChangesAsync();
        return true;
    }
}
