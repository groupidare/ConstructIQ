namespace ConstructIQ.API.Services;

// Thrown by AuthService when credentials are valid but the role selected at
// login doesn't match the account's actual assigned role — caught by
// AuthController before any MFA code is sent, so a role mismatch never
// reaches the point of emailing a verification code.
public class WrongRoleException(string actualRole) : Exception
{
    public string ActualRole { get; } = actualRole;
}
