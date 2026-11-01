using System.Text;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace ConstructIQ.Tests;

// /uploads/{key}: serves only the upload folders, never anything else in the
// bucket (e.g. the ML service's models/).
public class UploadsControllerTests
{
    private sealed class FakeStorage : IFileStorageService
    {
        public readonly List<string> Opened = [];
        public Task<string> UploadAsync(IFormFile file, string folder) => throw new NotSupportedException();
        public Task DeleteAsync(string url) => throw new NotSupportedException();
        public Task<byte[]> ReadAsync(string url) => throw new NotSupportedException();
        public Task<StoredFile?> OpenAsync(string key)
        {
            Opened.Add(key);
            return Task.FromResult<StoredFile?>(key.EndsWith("missing.jpg")
                ? null
                : new StoredFile(new MemoryStream(Encoding.UTF8.GetBytes("img")), "image/jpeg"));
        }
    }

    private static UploadsController Controller(FakeStorage storage) => new(storage)
    {
        ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
    };

    [Theory]
    [InlineData("avatars/ab12_me.jpg")]
    [InlineData("documents/7/ab12_plan.pdf")]
    [InlineData("deliveries/ab12_proof.png")]
    [InlineData("progress/ab12_site.jpg")]
    public async Task UploadFolders_AreServed(string key)
    {
        var storage = new FakeStorage();
        var result = await Controller(storage).Get(key);

        var file = Assert.IsType<FileStreamResult>(result);
        Assert.Equal("image/jpeg", file.ContentType);
        Assert.Equal([key], storage.Opened);
    }

    [Theory]
    [InlineData("models/manifest.json")]
    [InlineData("avatars/../models/manifest.json")]
    [InlineData("avatars//x.jpg")]
    [InlineData("")]
    public async Task OtherKeys_AreNotFound_AndNeverReachStorage(string key)
    {
        var storage = new FakeStorage();
        Assert.IsType<NotFoundResult>(await Controller(storage).Get(key));
        Assert.Empty(storage.Opened);
    }

    [Fact]
    public async Task MissingFile_IsNotFound()
    {
        Assert.IsType<NotFoundResult>(await Controller(new FakeStorage()).Get("avatars/missing.jpg"));
    }
}
