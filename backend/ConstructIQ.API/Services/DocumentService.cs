using System.Net.Http.Json;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Document;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class DocumentService(
    AppDbContext db,
    IFileStorageService storage,
    IHttpClientFactory httpFactory,
    ILogger<DocumentService> logger) : IDocumentService
{
    private const long MaxFileSizeBytes = 25 * 1024 * 1024; // 25 MB

    public async Task<ProjectDocumentDto> UploadAsync(IFormFile file, int projectId, string category, int userId, string? categoryOther = null, string? description = null)
    {
        if (file.Length == 0) throw new InvalidOperationException("The uploaded file is empty.");
        if (file.Length > MaxFileSizeBytes) throw new InvalidOperationException("File exceeds the 25 MB limit.");

        if (!Enum.TryParse<DocumentCategory>(category, true, out var parsedCategory))
            throw new InvalidOperationException($"Unknown document category '{category}'.");

        if (parsedCategory == DocumentCategory.Other && string.IsNullOrWhiteSpace(categoryOther))
            throw new InvalidOperationException("Please specify the category.");

        _ = await db.Projects.FindAsync(projectId)
            ?? throw new KeyNotFoundException("Project not found.");

        var storagePath = await storage.UploadAsync(file, $"documents/{projectId}");

        var doc = new ProjectDocument
        {
            ProjectId        = projectId,
            Category         = parsedCategory,
            CategoryOther    = parsedCategory == DocumentCategory.Other ? categoryOther!.Trim() : null,
            Description      = string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
            FileName         = file.FileName,
            StoragePath      = storagePath,
            SizeBytes        = file.Length,
            UploadedByUserId = userId,
        };

        db.ProjectDocuments.Add(doc);
        await db.SaveChangesAsync();

        var saved = await db.ProjectDocuments.Include(d => d.UploadedBy).Include(d => d.Project).FirstAsync(d => d.Id == doc.Id);
        return ToDto(saved);
    }

    public async Task<IEnumerable<ProjectDocumentDto>> GetByProjectAsync(int projectId)
    {
        var docs = await db.ProjectDocuments
            .Include(d => d.UploadedBy)
            .Include(d => d.Project)
            .Where(d => d.ProjectId == projectId)
            .OrderByDescending(d => d.UploadedAt)
            .ToListAsync();

        return docs.Select(ToDto);
    }

    public async Task<IEnumerable<ProjectDocumentDto>> GetAllAsync(int? projectId)
    {
        var query = db.ProjectDocuments
            .Include(d => d.UploadedBy)
            .Include(d => d.Project)
            .AsQueryable();

        if (projectId.HasValue) query = query.Where(d => d.ProjectId == projectId.Value);

        var docs = await query.OrderByDescending(d => d.UploadedAt).ToListAsync();
        return docs.Select(ToDto);
    }

    public async Task<DocumentParseResultDto> ParseAsync(int documentId)
    {
        var doc = await db.ProjectDocuments.FindAsync(documentId)
            ?? throw new KeyNotFoundException("Document not found.");

        var client = httpFactory.CreateClient("MLService");
        MlDocumentParseResponse? mlResponse;
        try
        {
            using var content = await BuildParseRequestContentAsync(doc);
            var response = await client.PostAsync("/documents/parse", content);
            response.EnsureSuccessStatusCode();
            mlResponse = await response.Content.ReadFromJsonAsync<MlDocumentParseResponse>();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Document parse failed for document {DocumentId}.", documentId);
            throw new InvalidOperationException("Couldn't parse this document right now. You can still fill in the fields manually.");
        }

        if (mlResponse is null)
            throw new InvalidOperationException("The parser returned an empty response.");

        var matches = await MaterialIdsByNameAsync();

        return new DocumentParseResultDto
        {
            PageCount   = mlResponse.PageCount,
            ParseErrors = mlResponse.ParseErrors,
            Items = mlResponse.Items.Select(i => new ParsedBoqRowDto
            {
                MaterialName      = i.MaterialName,
                Specification     = i.Specification,
                Unit              = i.Unit,
                EstimatedQuantity = (decimal)i.EstimatedQuantity,
                PhaseHint         = i.PhaseHint,
                PrimarySection    = i.PrimarySection,
                SubCategory       = i.SubCategory,
                HistoricalSupply  = i.HistoricalSupply.Select(s => new HistoricalSupplyLineDto
                {
                    PoNumber     = s.PoNumber,
                    PoDate       = s.PoDate,
                    MaterialName = s.MaterialName,
                    Unit         = s.Unit,
                    Quantity     = (decimal)s.Quantity,
                    SupplierName = s.SupplierName,
                    UnitCost     = s.UnitCost is double cost ? (decimal)cost : null,
                }).ToList(),
                MatchedMaterialId = matches.TryGetValue(MaterialNames.Canonical(i.MaterialName), out var id) ? id : null,
            }).ToList(),
        };
    }

    public async Task<PoParseResultDto> ParsePOAsync(int documentId)
    {
        var doc = await db.ProjectDocuments.FindAsync(documentId)
            ?? throw new KeyNotFoundException("Document not found.");

        var client = httpFactory.CreateClient("MLService");
        MlDocumentParsePoResponse? mlResponse;
        try
        {
            using var content = await BuildParseRequestContentAsync(doc);
            var response = await client.PostAsync("/documents/parse-po", content);
            response.EnsureSuccessStatusCode();
            mlResponse = await response.Content.ReadFromJsonAsync<MlDocumentParsePoResponse>();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "PO parse failed for document {DocumentId}.", documentId);
            throw new InvalidOperationException("Couldn't parse this document right now. You can still fill in the fields manually.");
        }

        if (mlResponse is null)
            throw new InvalidOperationException("The parser returned an empty response.");

        var materialMatches = await MaterialIdsByNameAsync();

        var supplierNames = mlResponse.Items
            .Where(i => !string.IsNullOrWhiteSpace(i.SupplierName))
            .Select(i => i.SupplierName!.Trim().ToLower())
            .Distinct()
            .ToList();
        var supplierMatches = (await db.Suppliers
            .Where(s => supplierNames.Contains(s.Name.Trim().ToLower()))
            .ToListAsync())
            .GroupBy(s => s.Name.Trim().ToLower())
            .ToDictionary(g => g.Key, g => g.First().Id);

        return new PoParseResultDto
        {
            PageCount   = mlResponse.PageCount,
            ParseErrors = mlResponse.ParseErrors,
            Items = mlResponse.Items.Select(i => new ParsedPoRowDto
            {
                MaterialName          = i.MaterialName,
                Unit                  = i.Unit,
                ActualQuantityOrdered = (decimal)i.ActualQuantityOrdered,
                SupplierName          = i.SupplierName,
                OrderDate             = DateTime.TryParse(i.OrderDate, out var od) ? od : null,
                PromisedDeliveryDate  = DateTime.TryParse(i.PromisedDeliveryDate, out var pd) ? pd : null,
                PhaseHint             = i.PhaseHint,
                UnitPrice             = i.UnitPrice is double price ? (decimal)price : null,
                PoNumber              = i.PoNumber,
                TotalMismatch         = i.TotalMismatch,
                MatchedMaterialId     = materialMatches.TryGetValue(MaterialNames.Canonical(i.MaterialName), out var mid) ? mid : null,
                MatchedSupplierId     = !string.IsNullOrWhiteSpace(i.SupplierName) && supplierMatches.TryGetValue(i.SupplierName.Trim().ToLower(), out var sid) ? sid : null,
            }).ToList(),
        };
    }

    // Uploads the file's actual bytes to the ml-service rather than a local
    // path — the backend and ml-service are separate processes with no
    // shared filesystem in any real deployment (Render, Docker containers),
    // so a path only meaningful on one side would never resolve on the
    // other. Reads go through the storage service (R2's S3 API) rather than
    // a GET on the public *.r2.dev URL — some ISPs block r2.dev (see
    // UploadsController), which made every parse fail on those networks.
    public async Task<byte[]> ReadFileBytesAsync(string storagePath)
    {
        try
        {
            return await storage.ReadAsync(storagePath);
        }
        catch (FileNotFoundException) when (
            storagePath.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || storagePath.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            // A web URL the current storage backend doesn't own (e.g. an R2
            // file while running on local storage) — fetch it directly.
            return await httpFactory.CreateClient().GetByteArrayAsync(storagePath);
        }
    }

    // Catalog ids by name, however the name is written (see MaterialNames).
    // GroupBy + First, not ToDictionary: the catalog can hold two rows whose
    // names differ only by case/whitespace (e.g. two "PPR Water Pipe, 20mm dia. x
    // 4m" entries) — ToDictionary throws ArgumentException on that duplicate key
    // instead of just picking one, which took down this endpoint in production.
    private async Task<Dictionary<string, int>> MaterialIdsByNameAsync() =>
        (await db.Materials.OrderBy(m => m.Id).Select(m => new { m.Id, m.Name }).ToListAsync())
            .GroupBy(m => MaterialNames.Canonical(m.Name))
            .ToDictionary(g => g.Key, g => g.First().Id);

    private async Task<MultipartFormDataContent> BuildParseRequestContentAsync(ProjectDocument doc)
    {
        var bytes = await ReadFileBytesAsync(doc.StoragePath);
        var content = new MultipartFormDataContent
        {
            { new StringContent(doc.ProjectId.ToString()), "project_id" },
            { new ByteArrayContent(bytes), "file", doc.FileName },
        };
        return content;
    }

    public async Task<bool> DeleteAsync(int documentId) =>
        await DeleteManyAsync([documentId]) > 0;

    // Deletes the documents in one go (one save, the stored files removed in
    // parallel) — "Delete selected" on 30 PO files is one request, not 30.
    // An imported PO read from one of these files goes with it (see
    // PurchaseOrderRemoval). Returns how many documents were deleted.
    public async Task<int> DeleteManyAsync(IReadOnlyCollection<int> documentIds)
    {
        var docs = await db.ProjectDocuments.Where(d => documentIds.Contains(d.Id)).ToListAsync();
        if (docs.Count == 0) return 0;
        var paths = docs.Select(d => d.StoragePath).ToList();
        var projectIds = docs.Select(d => d.ProjectId).Distinct().ToList();

        db.PurchaseOrders.RemoveRange(await db.PurchaseOrders
            .Where(po => po.IsImported && projectIds.Contains(po.ProjectId) && po.PoFileUrl != null && paths.Contains(po.PoFileUrl))
            .ToListAsync());
        // A PO made in ConstructIQ never comes from these folders; should one
        // still point at a file, that file itself is kept for it.
        var keep = (await db.PurchaseOrders
                .Where(po => !po.IsImported && po.PoFileUrl != null && paths.Contains(po.PoFileUrl))
                .Select(po => po.PoFileUrl!)
                .ToListAsync())
            .ToHashSet();

        db.ProjectDocuments.RemoveRange(docs);
        await db.SaveChangesAsync();

        await Task.WhenAll(docs.Where(d => !keep.Contains(d.StoragePath)).Select(async d =>
        {
            try { await storage.DeleteAsync(d.StoragePath); }
            catch (Exception ex) { logger.LogWarning(ex, "Couldn't delete R2 object for document {DocumentId}.", d.Id); }
        }));
        return docs.Count;
    }

    private static ProjectDocumentDto ToDto(ProjectDocument d) => new()
    {
        Id            = d.Id,
        ProjectId     = d.ProjectId,
        ProjectName   = d.Project?.Name ?? string.Empty,
        Category      = d.Category.ToString(),
        CategoryOther = d.CategoryOther,
        Description   = d.Description,
        FileName   = d.FileName,
        Url        = d.StoragePath,
        SizeBytes  = d.SizeBytes,
        UploadedBy = $"{d.UploadedBy.FirstName} {d.UploadedBy.LastName}",
        UploadedAt = d.UploadedAt,
    };
}
