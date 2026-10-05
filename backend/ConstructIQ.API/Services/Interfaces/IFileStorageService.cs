namespace ConstructIQ.API.Services.Interfaces;

public interface IFileStorageService
{
    // folder is just a key prefix (e.g. "documents/12", "avatars") — not a
    // local directory; nothing is ever written to this process's own disk.
    Task<string> UploadAsync(IFormFile file, string folder);
    Task DeleteAsync(string url);
}
