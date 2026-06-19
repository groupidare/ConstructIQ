namespace ConstructIQ.API.Models.DTOs.Auth;

public class LoginResponseDto
{
    public string    Token     { get; set; } = string.Empty;
    public UserDto   User      { get; set; } = null!;
    public DateTime  ExpiresAt { get; set; }
}

public class UserDto
{
    public int    Id        { get; set; }
    public string Username  { get; set; } = string.Empty;
    public string Email     { get; set; } = string.Empty;
    public string FirstName { get; set; } = string.Empty;
    public string LastName  { get; set; } = string.Empty;
    public string Role      { get; set; } = string.Empty;
    public bool   IsActive  { get; set; }
}
