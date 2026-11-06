using System.Security.Claims;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Models.DTOs.Notification;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ConstructIQ.Tests;

// An imported PO and the file it was read from are deleted together,
// whichever is deleted first. A PO made in ConstructIQ can be deleted only
// while Pending; after that it's cancelled, and stops counting.
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

    private sealed class NoNotifications : INotificationService
    {
        public Task CreateForRoleAsync(UserRole recipientRole, NotificationKind kind, string message, int createdByUserId,
            int? projectId = null, int? materialId = null, decimal? quantity = null, string? title = null, string? actionLink = null) => Task.CompletedTask;
        public Task<NotificationResponseDto> CreateAsync(NotificationCreateDto dto, int userId) => throw new NotSupportedException();
        public Task<IEnumerable<NotificationResponseDto>> GetMineAsync(int userId, string role) => throw new NotSupportedException();
        public Task<bool> MarkReadAsync(int id, int userId) => throw new NotSupportedException();
    }

    [Fact]
    public async Task DeletingAFile_DeletesTheImportedPoReadFromIt()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, po) = await SeedPoAsync(db, imported: true);
        var loose = await AddDocumentAsync(db, project.Id, admin.Id, "loose.jpg");
        var scan = await AddDocumentAsync(db, project.Id, admin.Id, "scan.jpg");
        po.PoFileUrl = scan.StoragePath;
        await db.SaveChangesAsync();
        var storage = new RecordingStorage();
        var service = new DocumentService(db, storage, null!, NullLogger<DocumentService>.Instance);

        Assert.True(await service.DeleteAsync(loose.Id));
        Assert.True(await db.PurchaseOrders.AnyAsync(p => p.Id == po.Id));

        Assert.True(await service.DeleteAsync(scan.Id));
        Assert.False(await db.PurchaseOrders.AnyAsync(p => p.Id == po.Id));
        Assert.False(await db.PurchaseOrderMaterials.AnyAsync(m => m.PurchaseOrderId == po.Id));
        Assert.Equal([loose.StoragePath, scan.StoragePath], storage.Deleted);
    }

    [Fact]
    public async Task DeletingAnImportedPo_DeletesItsFile()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, po) = await SeedPoAsync(db, imported: true);
        var scan = await AddDocumentAsync(db, project.Id, admin.Id, "scan.jpg");
        po.PoFileUrl = scan.StoragePath;
        await db.SaveChangesAsync();
        var storage = new RecordingStorage();

        Assert.IsType<NoContentResult>(await Controller(db, storage, admin).Delete(po.Id));

        Assert.False(await db.PurchaseOrders.AnyAsync(p => p.Id == po.Id));
        Assert.False(await db.ProjectDocuments.AnyAsync(d => d.Id == scan.Id));
        Assert.Equal([scan.StoragePath], storage.Deleted);
    }

    [Fact]
    public async Task SystemPo_DeletedOnlyWhilePending_ElseCancelled_AndStopsCounting()
    {
        await using var db = fixture.CreateContext();
        var (admin, project, po) = await SeedPoAsync(db, imported: false);
        po.Status = PurchaseOrderStatus.Approved;
        var request = new MaterialRequest
        {
            ProjectId = project.Id, MaterialId = (await db.PurchaseOrderMaterials.FirstAsync(m => m.PurchaseOrderId == po.Id)).MaterialId!.Value,
            Quantity = 5, Unit = "pcs", RequestedByUserId = admin.Id, SubmittedForApprovalAt = DateTime.UtcNow, FulfilledByPurchaseOrderId = po.Id,
        };
        db.MaterialRequests.Add(request);
        await db.SaveChangesAsync();
        var controller = Controller(db, new RecordingStorage(), admin);

        Assert.IsType<BadRequestObjectResult>(await controller.Delete(po.Id));
        Assert.IsType<OkObjectResult>(await controller.Cancel(po.Id));

        await using var verify = fixture.CreateContext();
        Assert.Equal(PurchaseOrderStatus.Cancelled, (await verify.PurchaseOrders.FindAsync(po.Id))!.Status);
        // Back to "For Approval", to choose another supplier.
        Assert.Null((await verify.MaterialRequests.FindAsync(request.Id))!.FulfilledByPurchaseOrderId);
        Assert.Equal(0m, (await new MaterialCostService(verify).GetEstimatedMaterialCostAsync(project.Id))!.CommittedCost);
    }

    private static async Task<(User, Project, PurchaseOrder)> SeedPoAsync(ConstructIQ.API.Data.AppDbContext db, bool imported)
    {
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var line = await TestDataBuilder.CreateDeliveredPoLineAsync(db, project.Id, admin.Id,
            (await TestDataBuilder.CreateMaterialAsync(db)).Id, 4, unitPrice: 25);
        var po = await db.PurchaseOrders.SingleAsync(p => p.Id == line.PurchaseOrderId);
        po.IsImported = imported;
        po.Status = imported ? PurchaseOrderStatus.Delivered : PurchaseOrderStatus.Pending;
        await db.SaveChangesAsync();
        return (admin, project, po);
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

    private static PurchaseOrdersController Controller(ConstructIQ.API.Data.AppDbContext db, IFileStorageService storage, User user) =>
        new(db, storage, new NoNotifications())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                        new Claim(ClaimTypes.Role, user.Role.ToString()),
                    ], "Test")),
                },
            },
        };
}
