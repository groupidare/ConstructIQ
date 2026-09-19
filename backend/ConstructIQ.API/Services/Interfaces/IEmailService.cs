namespace ConstructIQ.API.Services.Interfaces;

public interface IEmailService
{
    Task SendPasswordResetEmailAsync(string toEmail, string toName, string resetLink);
    Task SendMfaCodeEmailAsync(string toEmail, string toName, string code, bool isNewDevice = false);
}
