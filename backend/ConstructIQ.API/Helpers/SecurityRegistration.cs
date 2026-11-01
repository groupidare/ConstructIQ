using System.Text;
using ConstructIQ.API.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace ConstructIQ.API.Helpers;

public static class SecurityRegistration
{
    public static void AddConstructIqSecurity(this IServiceCollection services, IConfiguration config)
    {
        var jwtSecret = config["JWT_SECRET"]
            ?? throw new InvalidOperationException("JWT_SECRET not configured.");
        
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(opts =>
            {
                opts.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer           = true,
                    ValidateAudience         = true,
                    ValidateLifetime         = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer              = config["JWT_ISSUER"],
                    ValidAudience            = config["JWT_AUDIENCE"],
                    IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
                    ClockSkew                = TimeSpan.Zero,
                    ValidAlgorithms          = [SecurityAlgorithms.HmacSha256],
                };
                opts.Events = new JwtBearerEvents
                {
                    OnTokenValidated = async context =>
                    {
                        var id = context.Principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                        var user = int.TryParse(id, out var userId) ? await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId) : null;
                        if (user is null || !user.IsActive ||
                            (context.Principal?.FindFirst("security_stamp")?.Value ?? "") != (user.SecurityStamp ?? ""))
                        {
                            context.Fail("Session is no longer valid.");
                            return;
                        }
                        var identity = (System.Security.Claims.ClaimsIdentity)context.Principal!.Identity!;
                        foreach (var claim in identity.FindAll(identity.RoleClaimType).ToList()) identity.RemoveClaim(claim);
                        identity.AddClaim(new System.Security.Claims.Claim(identity.RoleClaimType, user.Role.ToString()));
                    },
                };
            });
        
        services.AddAuthorization(options => options.AddPolicy("AdminOnly", policy => policy.RequireAuthenticatedUser().RequireRole("Admin")));
        
    }
}
