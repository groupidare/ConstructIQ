using System.Net.Http.Json;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Document;
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
    private static readonly string[] AllowedExtensions =
        [".pdf", ".xlsx", ".xls", ".csv", ".docx", ".png", ".jpg", ".jpeg"];

    private const long MaxFileSizeBytes = 25 * 1024 * 1024; // 25 MB

    public async Task<ProjectDocumentDto> UploadAsync(IFormFile file, int projectId, string category, int userId)
    {
        if (file.Length == 0) throw new InvalidOperationException("The uploaded file is empty.");
        if (file.Length > MaxFileSizeBytes) throw new InvalidOperationException("File exceeds the 25 MB limit.");

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedExtensions.Contains(ext))
            throw new InvalidOperationException($"File type '{ext}' isn't supported.");

        if (!Enum.TryParse<DocumentCategory>(category, true, out var parsedCategory))
            throw new InvalidOperationException($"Unknown document category '{category}'.");

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
            FileName         = file.FileName,
            StoragePath      = $"/uploads/{projectId}/{storedFileName}",
            SizeBytes        = file.Length,
            UploadedByUserId = userId,
        };

        db.ProjectDocuments.Add(doc);
        await db.SaveChangesAsync();

        var saved = await db.ProjectDocuments.Include(d => d.UploadedBy).FirstAsync(d => d.Id == doc.Id);
        return ToDto(saved);
    }

    public async Task<IEnumerable<ProjectDocumentDto>> GetByProjectAsync(int projectId)
    {
        var docs = await db.ProjectDocuments
            .Include(d => d.UploadedBy)
            .Where(d => d.ProjectId == projectId)
            .OrderByDescending(d => d.UploadedAt)
            .ToListAsync();

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
                MatchedMaterialId = matches.TryGetValue(i.MaterialName.Trim().ToLower(), out var id) ? id : null,
            }).ToList(),
        };
    }

    public async Task<MeasurementParseResultDto> ParseMeasurementsAsync(int documentId)
    {
        var doc = await db.ProjectDocuments.FindAsync(documentId)
            ?? throw new KeyNotFoundException("Document not found.");

        var webRoot = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        var absolutePath = Path.Combine(webRoot, doc.StoragePath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

        var client = httpFactory.CreateClient("MLService");
        MlDocumentParseMeasurementsResponse? mlResponse;
        try
        {
            var response = await client.PostAsJsonAsync("/documents/parse-measurements", new MlDocumentParseRequest
            {
                FilePath  = absolutePath,
                ProjectId = doc.ProjectId,
            });
            response.EnsureSuccessStatusCode();
            mlResponse = await response.Content.ReadFromJsonAsync<MlDocumentParseMeasurementsResponse>();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Measurement scan failed for document {DocumentId}.", documentId);
            throw new InvalidOperationException("Couldn't scan this document right now. You can still fill in measurements manually.");
        }

        if (mlResponse is null)
            throw new InvalidOperationException("The scanner returned an empty response.");

        return new MeasurementParseResultDto
        {
            PageCount    = mlResponse.PageCount,
            OcrPagesUsed = mlResponse.OcrPagesUsed,
            ParseErrors  = mlResponse.ParseErrors,
            Items = mlResponse.Items.Select(i => new ParsedMeasurementRowDto
            {
                ElementType = i.ElementType,
                LengthM     = (decimal)i.LengthM,
                WidthM      = (decimal)i.WidthM,
                HeightM     = (decimal)i.HeightM,
                ThicknessM  = (decimal)i.ThicknessM,
                AreaLabel   = i.AreaLabel,
                SourcePage  = i.SourcePage,
                OcrUsed     = i.OcrUsed,
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
        Id         = d.Id,
        ProjectId  = d.ProjectId,
        Category   = d.Category.ToString(),
        FileName   = d.FileName,
        Url        = d.StoragePath,
        SizeBytes  = d.SizeBytes,
        UploadedBy = $"{d.UploadedBy.FirstName} {d.UploadedBy.LastName}",
        UploadedAt = d.UploadedAt,
    };
}
