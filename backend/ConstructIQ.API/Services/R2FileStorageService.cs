using Amazon.S3;
using Amazon.S3.Model;
using ConstructIQ.API.Services.Interfaces;

namespace ConstructIQ.API.Services;

// Cloudflare R2, over its S3-compatible API — replaces writing uploads to
// local container disk, which Render's free tier wipes on every deploy or
// idle restart (same category of free-tier limitation as Aiven's
// auto-power-off and the SMTP port block already worked around elsewhere in
// this app). R2 is a separate, persistent service, so files survive deploys.
public class R2FileStorageService : IFileStorageService
{
    private readonly AmazonS3Client _client;
    private readonly string _bucket;
    private readonly string _publicUrl;

    public R2FileStorageService(IConfiguration config)
    {
        _bucket = config["R2_BUCKET_NAME"]
            ?? throw new InvalidOperationException("R2_BUCKET_NAME is not configured.");
        _publicUrl = (config["R2_PUBLIC_URL"]
            ?? throw new InvalidOperationException("R2_PUBLIC_URL is not configured.")).TrimEnd('/');

        var endpoint = config["R2_ENDPOINT_URL"]
            ?? throw new InvalidOperationException("R2_ENDPOINT_URL is not configured.");
        var accessKey = config["R2_ACCESS_KEY_ID"]
            ?? throw new InvalidOperationException("R2_ACCESS_KEY_ID is not configured.");
        var secretKey = config["R2_SECRET_ACCESS_KEY"]
            ?? throw new InvalidOperationException("R2_SECRET_ACCESS_KEY is not configured.");

        _client = new AmazonS3Client(accessKey, secretKey, new AmazonS3Config
        {
            ServiceURL = endpoint,
            // R2 requires path-style addressing (bucket.region... virtual-hosted
            // style, the SDK's default, doesn't work against R2's endpoint).
            ForcePathStyle = true,
        });
    }

    public async Task<string> UploadAsync(IFormFile file, string folder)
    {
        var key = $"{folder}/{Guid.NewGuid():N}_{Path.GetFileName(file.FileName)}";

        await using var stream = file.OpenReadStream();
        await _client.PutObjectAsync(new PutObjectRequest
        {
            BucketName  = _bucket,
            Key         = key,
            InputStream = stream,
            ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
            // The SDK defaults a streamed PutObject to chunked SigV4
            // signing (STREAMING-AWS4-HMAC-SHA256-PAYLOAD[-TRAILER]) — R2
            // implements neither variant and rejects the upload outright.
            // These two (confirmed to actually exist on PutObjectRequest,
            // not AmazonS3Config, by reflecting over the installed SDK)
            // force classic, fully-buffered signing instead, which R2 does
            // support.
            UseChunkEncoding = false,
            DisablePayloadSigning = true,
        });

        return $"{_publicUrl}/{key}";
    }

    public async Task DeleteAsync(string url)
    {
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith(_publicUrl, StringComparison.OrdinalIgnoreCase))
            return; // not an R2 URL (e.g. a stale local "/uploads/..." path from before this migration) — nothing to delete there anymore.

        var key = url[(_publicUrl.Length + 1)..]; // +1 to drop the separating '/'
        try
        {
            await _client.DeleteObjectAsync(_bucket, key);
        }
        catch (AmazonS3Exception)
        {
            // Best-effort — a missing/already-deleted object shouldn't block
            // the caller's own delete (of the DB row, etc.).
        }
    }
}
