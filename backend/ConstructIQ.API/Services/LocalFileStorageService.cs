using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.StaticFiles;

namespace ConstructIQ.API.Services;

public sealed class LocalFileStorageService : IFileStorageService
{
    private readonly string _uploadRoot;

    public LocalFileStorageService(IWebHostEnvironment environment)
    {
        _uploadRoot = Path.Combine(environment.WebRootPath ?? Path.Combine(environment.ContentRootPath, "wwwroot"), "uploads");
        Directory.CreateDirectory(_uploadRoot);
    }

    public async Task<string> UploadAsync(IFormFile file, string folder)
    {
        var safeFolder = GetSafeFolder(folder);
        var filename = $"{Guid.NewGuid():N}_{Path.GetFileName(file.FileName)}";
        var key = string.IsNullOrEmpty(safeFolder) ? filename : $"{safeFolder}/{filename}";
        var path = GetPath(key);

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var stream = File.Create(path);
        await file.CopyToAsync(stream);

        return $"/uploads/{key.Replace(Path.DirectorySeparatorChar, '/')}";
    }

    public Task DeleteAsync(string url)
    {
        if (!url.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
            return Task.CompletedTask;

        var key = url["/uploads/".Length..].Replace('/', Path.DirectorySeparatorChar);
        var path = GetPath(key);
        if (File.Exists(path))
            File.Delete(path);

        return Task.CompletedTask;
    }

    public Task<byte[]> ReadAsync(string url)
    {
        if (!url.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
            throw new FileNotFoundException("Not a local upload.", url);

        var key = url["/uploads/".Length..].Replace('/', Path.DirectorySeparatorChar);
        return File.ReadAllBytesAsync(GetPath(key));
    }

    public Task<StoredFile?> OpenAsync(string key)
    {
        var path = GetPath(key.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(path))
            return Task.FromResult<StoredFile?>(null);

        if (!new FileExtensionContentTypeProvider().TryGetContentType(path, out var contentType))
            contentType = "application/octet-stream";
        return Task.FromResult<StoredFile?>(new StoredFile(File.OpenRead(path), contentType));
    }

    private string GetSafeFolder(string folder)
    {
        var segments = folder.Split('/', '\\', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(segment => segment is "." or ".." || segment.IndexOfAny(Path.GetInvalidPathChars()) >= 0))
            throw new InvalidOperationException("The upload folder is invalid.");

        return string.Join(Path.DirectorySeparatorChar, segments);
    }

    private string GetPath(string key)
    {
        var path = Path.GetFullPath(Path.Combine(_uploadRoot, key));
        var root = Path.GetFullPath(_uploadRoot) + Path.DirectorySeparatorChar;
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The upload path is invalid.");

        return path;
    }
}
