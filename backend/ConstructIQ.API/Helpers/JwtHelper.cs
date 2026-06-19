using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ConstructIQ.API.Models.Entities;
using Microsoft.IdentityModel.Tokens;

namespace ConstructIQ.API.Helpers;

public static class JwtHelper
{
    public static string GenerateToken(User user, IConfiguration config)
    {
        var secret   = config["JWT_SECRET"]!;
        var issuer   = config["JWT_ISSUER"]!;
        var audience = config["JWT_AUDIENCE"]!;
        var expires  = int.TryParse(config["JWT_EXPIRES_HOURS"], out var h) ? h : 24;

        var key   = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub,   user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim("username", user.Username),
            new Claim("role",     user.Role.ToString()),
            new Claim("firstName",user.FirstName),
            new Claim("lastName", user.LastName),
        };

        var token = new JwtSecurityToken(
            issuer:             issuer,
            audience:           audience,
            claims:             claims,
            expires:            DateTime.UtcNow.AddHours(expires),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
