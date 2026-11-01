using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

// Serves uploaded files (avatars, project documents, delivery and progress
// photos) from this API's own domain. Files live in Cloudflare R2, but its
// public *.r2.dev address is blocked by some ISPs, so browsers on those
// networks couldn't load them; the frontend rewrites r2.dev links to here
// (see frontend/src/lib/avatar.ts).
//
// Anonymous on purpose: <img>/<a> requests carry no JWT. That's the same
// exposure the public r2.dev URLs already had — keys contain a random GUID.
// Only the upload folders are served; anything else in the bucket (e.g. the
// ML service's models/) is not.
[ApiController]
[AllowAnonymous]
public class UploadsController(IFileStorageService storage) : ControllerBase
{
    private static readonly string[] AllowedFolders = ["avatars/", "deliveries/", "documents/", "progress/"];

    [HttpGet("/uploads/{**key}")]
    public async Task<IActionResult> Get(string key)
    {
        if (string.IsNullOrWhiteSpace(key)
            || !AllowedFolders.Any(f => key.StartsWith(f, StringComparison.Ordinal))
            || key.Split('/').Any(segment => segment is "" or "." or ".."))
            return NotFound();

        var file = await storage.OpenAsync(key);
        if (file is null)
            return NotFound();

        // A key never changes content — a re-upload gets a new GUID key.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.RegisterForDispose(file);
        return File(file.Content, file.ContentType);
    }
}
