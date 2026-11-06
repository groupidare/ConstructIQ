using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ConstructIQ.Tests;

// Removing a project file: the stored file goes too, unless a purchase order
// made from it (an imported PO) still has it as its attached scan.
[Collection("Database")]
public class DocumentDeleteTests(DatabaseFixture fixture)
{
    private sealed class RecordingStorage : IFileStorageService
    {
        public readonly List<string> Deleted = [];
        public Task<string> UploadAsync(IFormFile file, string folder) => throw new NotSupportedException();
        public Task DeleteAsync(string url) { Deleted.Add(url); return Task.CompletedTask; }
        public Task<byte[]> ReadAsync(string url) => throw new NotSupportedException();
        public Task<StoredFile?> OpenAsync(string key) => throw new NotSupportedException();
    }

    [Fact]
    public async Task Delete_RemovesTheFile_ButKeepsOneAPurchaseOrderIsAttachedTo()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var loose = await AddDocumentAsync(db, project.Id, admin.Id, "loose.jpg");
        var attached = await AddDocumentAsync(db, project.Id, admin.Id, "attached.jpg");
        var poLine = await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id,
            (await TestDataBuilder.CreateMaterialAsync(db)).Id, 1);
        var po = await db.PurchaseOrders.SingleAsync(p => p.Id == poLine.PurchaseOrderId);
        po.PoFileUrl = attached.StoragePath;
        await db.SaveChangesAsync();
        var storage = new RecordingStorage();
        var service = new DocumentService(db, storage, null!, NullLogger<DocumentService>.Instance);

        Assert.True(await service.DeleteAsync(loose.Id));
        Assert.True(await service.DeleteAsync(attached.Id));

        Assert.Equal([loose.StoragePath], storage.Deleted);
        Assert.False(await db.ProjectDocuments.AnyAsync(d => d.Id == loose.Id || d.Id == attached.Id));
    }

    private static async Task<ProjectDocument> AddDocumentAsync(ConstructIQ.API.Data.AppDbContext db, int projectId, int userId, string name)
    {
        var doc = new ProjectDocument
        {
            ProjectId = projectId, Category = DocumentCategory.PurchaseOrder, FileName = name,
            StoragePath = $"documents/{projectId}/{Guid.NewGuid():N}_{name}", UploadedByUserId = userId,
        };
        db.ProjectDocuments.Add(doc);
        await db.SaveChangesAsync();
        return doc;
    }
}
