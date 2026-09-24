using System.Net.Http.Json;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Document;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class DocumentService(
    AppDbContext db,
    IWebHostEnvironment env,
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

        var webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        var uploadsDir = Path.Combine(webRoot, "uploads", projectId.ToString());
        Directory.CreateDirectory(uploadsDir);

        var storedFileName = $"{Guid.NewGuid():N}_{Path.GetFileName(file.FileName)}";
        var fullPath = Path.Combine(uploadsDir, storedFileName);

        using (var stream = new FileStream(fullPath, FileMode.Create))
            await file.CopyToAsync(stream);

        var doc = new ProjectDocument
        {
            ProjectId        = projectId,
            Category         = parsedCategory,
            CategoryOther    = parsedCategory == DocumentCategory.Other ? categoryOther!.Trim() : null,
            Description      = string.IsNullOrWhiteSpace(description) ? null : description.Trim(),
            FileName         = file.FileName,
            StoragePath      = $"/uploads/{projectId}/{storedFileName}",
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

        // ML service reads this off local disk — only correct when both processes
        // share a filesystem (true for local dev; a Docker deployment would need a
        // shared volume mounted at the same path on both containers).
        var webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        var absolutePath = Path.Combine(webRoot, doc.StoragePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

        var client = httpFactory.CreateClient("MLService");
        MlDocumentParseResponse? mlResponse;
        try
        {
            var response = await client.PostAsJsonAsync("/documents/parse", new MlDocumentParseRequest
            {
                FilePath  = absolutePath,
                ProjectId = doc.ProjectId,
            });
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

        var materialNames = mlResponse.Items.Select(i => i.MaterialName.Trim().ToLower()).Distinct().ToList();
        var matches = await db.Materials
            .Where(m => materialNames.Contains(m.Name.Trim().ToLower()))
            .ToDictionaryAsync(m => m.Name.Trim().ToLower(), m => m.Id);

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
                    MaterialName = s.MaterialName,
                    Unit         = s.Unit,
                    Quantity     = (decimal)s.Quantity,
                    SupplierName = s.SupplierName,
                }).ToList(),
                MatchedMaterialId = matches.TryGetValue(i.MaterialName.Trim().ToLower(), out var id) ? id : null,
            }).ToList(),
        };
    }

    public async Task<PoParseResultDto> ParsePOAsync(int documentId)
    {
        var doc = await db.ProjectDocuments.FindAsync(documentId)
            ?? throw new KeyNotFoundException("Document not found.");

        var webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        var absolutePath = Path.Combine(webRoot, doc.StoragePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

        var client = httpFactory.CreateClient("MLService");
        MlDocumentParsePoResponse? mlResponse;
        try
        {
            var response = await client.PostAsJsonAsync("/documents/parse-po", new MlDocumentParseRequest
            {
                FilePath  = absolutePath,
                ProjectId = doc.ProjectId,
            });
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

        var materialNames = mlResponse.Items.Select(i => i.MaterialName.Trim().ToLower()).Distinct().ToList();
        var materialMatches = await db.Materials
            .Where(m => materialNames.Contains(m.Name.Trim().ToLower()))
            .ToDictionaryAsync(m => m.Name.Trim().ToLower(), m => m.Id);

        var supplierNames = mlResponse.Items
            .Where(i => !string.IsNullOrWhiteSpace(i.SupplierName))
            .Select(i => i.SupplierName!.Trim().ToLower())
            .Distinct()
            .ToList();
        var supplierMatches = await db.Suppliers
            .Where(s => supplierNames.Contains(s.Name.Trim().ToLower()))
            .ToDictionaryAsync(s => s.Name.Trim().ToLower(), s => s.Id);

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
                MatchedMaterialId     = materialMatches.TryGetValue(i.MaterialName.Trim().ToLower(), out var mid) ? mid : null,
                MatchedSupplierId     = !string.IsNullOrWhiteSpace(i.SupplierName) && supplierMatches.TryGetValue(i.SupplierName.Trim().ToLower(), out var sid) ? sid : null,
            }).ToList(),
        };
    }

    public async Task<bool> DeleteAsync(int documentId)
    {
        var doc = await db.ProjectDocuments.FindAsync(documentId);
        if (doc is null) return false;

        var webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        var absolutePath = Path.Combine(webRoot, doc.StoragePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
        try { if (File.Exists(absolutePath)) File.Delete(absolutePath); }
        catch (Exception ex) { logger.LogWarning(ex, "Couldn't delete file on disk for document {DocumentId}.", documentId); }

        db.ProjectDocuments.Remove(doc);
        await db.SaveChangesAsync();
        return true;
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
