namespace ConstructIQ.API.Services.Interfaces;

public interface IFileStorageService
{
    // folder is just a key prefix (e.g. "documents/12", "avatars") — not a
    // local directory; nothing is ever written to this process's own disk.
    Task<string> UploadAsync(IFormFile file, string folder);
    Task DeleteAsync(string url);
    // Reads back a file previously returned by UploadAsync.
    Task<byte[]> ReadAsync(string url);
    // Streams one stored file by its key (e.g. "avatars/ab12_me.jpg") for
    // UploadsController; null when it doesn't exist.
    Task<StoredFile?> OpenAsync(string key);
}

public sealed record StoredFile(Stream Content, string ContentType) : IDisposable
{
    public void Dispose() => Content.Dispose();
}
