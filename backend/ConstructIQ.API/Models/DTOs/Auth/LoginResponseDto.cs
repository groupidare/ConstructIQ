namespace ConstructIQ.API.Models.DTOs.Auth;

public class LoginResponseDto
{
    // Set when the account has MFA enabled: no token is issued yet, the caller
    // must submit the emailed code to /auth/mfa/verify to get one.
    public bool     MfaRequired    { get; set; }
    public string?  ChallengeToken { get; set; }

    public string?   Token     { get; set; }
    public UserDto?  User      { get; set; }
    public DateTime? ExpiresAt { get; set; }
}

public class UserDto
{
    public int     Id        { get; set; }
    public string  Username  { get; set; } = string.Empty;
    public string  Email     { get; set; } = string.Empty;
    public string  FirstName { get; set; } = string.Empty;
    public string  LastName  { get; set; } = string.Empty;
    public string  Role      { get; set; } = string.Empty;
    public bool    IsActive  { get; set; }
    public string? AvatarUrl { get; set; }
    public bool    MfaEnabled { get; set; }
}

public record VerifyMfaRequestDto(string ChallengeToken, string Code);
public record ResendMfaRequestDto(string ChallengeToken);
