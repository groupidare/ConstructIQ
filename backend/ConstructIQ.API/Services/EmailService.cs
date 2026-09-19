using System.Net;
using System.Net.Mail;
using ConstructIQ.API.Services.Interfaces;

namespace ConstructIQ.API.Services;

// Sends mail through Gmail's SMTP relay using an account's App Password
// (Google Account -> Security -> 2-Step Verification -> App Passwords).
// This is separate from "Sign in with Google" — no OAuth client is involved.
public class EmailService(IConfiguration config, ILogger<EmailService> logger) : IEmailService
{
    public async Task SendPasswordResetEmailAsync(string toEmail, string toName, string resetLink)
    {
        var host       = config["SMTP_HOST"] ?? "smtp.gmail.com";
        var port       = int.TryParse(config["SMTP_PORT"], out var p) ? p : 587;
        var user       = config["SMTP_USER"];
        var appPassword = config["SMTP_APP_PASSWORD"];
        var fromName   = config["SMTP_FROM_NAME"] ?? "ConstructIQ";

        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(appPassword))
        {
            logger.LogWarning("SMTP_USER / SMTP_APP_PASSWORD not configured — password reset email to {Email} was not sent.", toEmail);
            return;
        }

        using var client = new SmtpClient(host, port)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(user, appPassword),
        };

        using var message = new MailMessage
        {
            From = new MailAddress(user, fromName),
            Subject = "Reset your ConstructIQ password",
            IsBodyHtml = true,
            Body = $"""
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
                  <h2 style="color:#111827;">Reset your password</h2>
                  <p style="color:#374151;">Hi {WebUtility.HtmlEncode(toName)},</p>
                  <p style="color:#374151;">
                    We received a request to reset the password for your ConstructIQ account.
                    This link expires in 30 minutes.
                  </p>
                  <p style="margin:24px 0;">
                    <a href="{resetLink}" style="background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                      Reset Password
                    </a>
                  </p>
                  <p style="color:#9ca3af;font-size:0.85rem;">
                    If you didn't request this, you can safely ignore this email.
                  </p>
                </div>
                """,
        };
        message.To.Add(new MailAddress(toEmail, toName));

        await client.SendMailAsync(message);
    }

    public async Task SendMfaCodeEmailAsync(string toEmail, string toName, string code, bool isNewDevice = false)
    {
        var host        = config["SMTP_HOST"] ?? "smtp.gmail.com";
        var port        = int.TryParse(config["SMTP_PORT"], out var p) ? p : 587;
        var user        = config["SMTP_USER"];
        var appPassword = config["SMTP_APP_PASSWORD"];
        var fromName    = config["SMTP_FROM_NAME"] ?? "ConstructIQ";

        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrWhiteSpace(appPassword))
        {
            logger.LogWarning("SMTP_USER / SMTP_APP_PASSWORD not configured — MFA code email to {Email} was not sent.", toEmail);
            return;
        }

        using var client = new SmtpClient(host, port)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(user, appPassword),
        };

        var intro = isNewDevice
            ? "We noticed a sign-in to your ConstructIQ account from a device or browser we haven't seen before. Use the code below to verify it's really you."
            : "Use the code below to finish signing in to your ConstructIQ account.";

        using var message = new MailMessage
        {
            From = new MailAddress(user, fromName),
            Subject = isNewDevice ? "New device sign-in — verify it's you" : "Your ConstructIQ verification code",
            IsBodyHtml = true,
            Body = $"""
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
                  <h2 style="color:#111827;">Verify your sign-in</h2>
                  <p style="color:#374151;">Hi {WebUtility.HtmlEncode(toName)},</p>
                  <p style="color:#374151;">
                    {intro}
                    This code expires in 10 minutes.
                  </p>
                  <p style="margin:24px 0;font-size:2rem;font-weight:700;letter-spacing:0.3em;color:#111827;">
                    {WebUtility.HtmlEncode(code)}
                  </p>
                  <p style="color:#9ca3af;font-size:0.85rem;">
                    If you didn't try to sign in, please contact your administrator immediately.
                  </p>
                </div>
                """,
        };
        message.To.Add(new MailAddress(toEmail, toName));

        await client.SendMailAsync(message);
    }
}
