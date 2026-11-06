using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Deleting purchase orders. An imported PO and the file it was read from go
// together, whichever is deleted first, so the PO list never shows a PO
// without its scan or keeps counting one whose scan was removed. Its
// materials, delivery batches and rating go with it (cascade); a material
// request it came from returns to "For Approval" (its link is cleared).
public static class PurchaseOrderRemoval
{
    // An imported PO can always be deleted; one made in ConstructIQ only while
    // still Pending — after that it's cancelled instead, keeping its history.
    public static string? CannotDelete(PurchaseOrder po) =>
        po.IsImported || po.Status == PurchaseOrderStatus.Pending
            ? null
            : "Only a Pending purchase order can be deleted — cancel it instead.";

    public static async Task DeleteAsync(AppDbContext db, IFileStorageService storage, PurchaseOrder po)
    {
        if (po.IsImported && !string.IsNullOrWhiteSpace(po.PoFileUrl))
        {
            var docs = await db.ProjectDocuments
                .Where(d => d.ProjectId == po.ProjectId && d.StoragePath == po.PoFileUrl)
                .ToListAsync();
            db.ProjectDocuments.RemoveRange(docs);
            var sharedWithAnother = await db.PurchaseOrders.AnyAsync(p => p.Id != po.Id && p.PoFileUrl == po.PoFileUrl);
            if (!sharedWithAnother)
            {
                try { await storage.DeleteAsync(po.PoFileUrl); }
                catch { /* the record is what matters; a leftover file is harmless */ }
            }
        }
        db.PurchaseOrders.Remove(po);
        await db.SaveChangesAsync();
    }
}
