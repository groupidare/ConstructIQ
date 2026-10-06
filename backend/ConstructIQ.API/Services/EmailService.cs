using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using ConstructIQ.API.Services.Interfaces;

namespace ConstructIQ.API.Services;

// Sends mail through Resend's HTTP API (api.resend.com), not raw SMTP.
// Render's free tier silently drops outbound SMTP connections (port 587/465)
// rather than refusing them, so SmtpClient just hung until .NET's own ~100s
// timeout fired — every login effectively froze for almost two minutes before
// failing anyway. HTTPS (443) is never blocked this way, so Resend's REST API
// is used instead.
public class EmailService(IHttpClientFactory httpFactory, IConfiguration config, ILogger<EmailService> logger) : IEmailService
{
    // Falls back to Resend's shared sandbox sender — works with no domain
    // setup, but only delivers to the email on the Resend account itself, not
    // to real app users. RESEND_FROM_ADDRESS should be set to an address on a
    // verified custom domain (e.g. noreply@constructiq.cfd) for real delivery.
    private string FromAddress => config["RESEND_FROM_ADDRESS"] ?? "onboarding@resend.dev";

    private record ResendRequest(
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("to")] string[] To,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("html")] string Html);

    private async Task<bool> TrySendAsync(string toEmail, string subject, string html)
    {
        var apiKey = config["RESEND_API_KEY"];
        if (string.IsNullOrWhiteSpace(apiKey))
            return false;

        var fromName = config["SMTP_FROM_NAME"] ?? "ConstructIQ";
        var fromAddress = config["RESEND_FROM_ADDRESS"] ?? DefaultFromAddress;
        var client = httpFactory.CreateClient("Resend");
        var response = await client.PostAsJsonAsync("emails", new ResendRequest(
            From: $"{fromName} <{fromAddress}>",
            To: [toEmail],
            Subject: subject,
            Html: html));
        response.EnsureSuccessStatusCode();
        return true;
    }

    public async Task SendPasswordChangeCodeAsync(string email, string code)
    {
        var sent = await TrySendAsync(email, "Verify your ConstructIQ password change", $"""
            <p>Your password change verification code is <strong>{WebUtility.HtmlEncode(code)}</strong>. It expires in 5 minutes.
            Do not share this code. If you did not request this, contact your administrator.</p>
            """);
        if (!sent)
            throw new InvalidOperationException("Email delivery is not configured.");
    }

    public async Task SendPasswordResetEmailAsync(string toEmail, string toName, string resetLink)
    {
        var sent = await TrySendAsync(toEmail, "Reset your ConstructIQ password", $"""
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
            """);
        if (!sent)
            logger.LogWarning("RESEND_API_KEY not configured — password reset email to {Email} was not sent.", toEmail);
    }

    public async Task SendMfaCodeEmailAsync(string toEmail, string toName, string code, bool isNewDevice = false)
    {
        var intro = isNewDevice
            ? "We noticed a sign-in to your ConstructIQ account from a device or browser we haven't seen before. Use the code below to verify it's really you."
            : "Use the code below to finish signing in to your ConstructIQ account.";

        var sent = await TrySendAsync(toEmail,
            isNewDevice ? "New device sign-in — verify it's you" : "Your ConstructIQ verification code", $"""
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
            """);
        if (!sent)
            logger.LogWarning("RESEND_API_KEY not configured — MFA code email to {Email} was not sent.", toEmail);
    }
}
