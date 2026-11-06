using System.Net.Http.Json;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Blueprint;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Blueprint → measurements → generated BOQ, by proxy to the ML service.
// Extraction, generation and the merge preview are previews; the wizard saves
// what the user confirms through the existing /api/measurements/bulk and
// /api/boq/bulk. The one thing kept here is the read itself (BlueprintRead),
// so the Material Plan can show a generated row on the plan later — with the
// blueprint's pages rendered on demand from the stored PDF.
public class BlueprintService(
    AppDbContext db,
    IDocumentService documents,
    IHttpClientFactory httpFactory,
    ILogger<BlueprintService> logger) : IBlueprintService
{
    // Named client with a long timeout — a large plan set's first read takes
    // a minute or more (see Program.cs).
    private HttpClient Ml => httpFactory.CreateClient("MLServiceLong");

    public async Task<BlueprintResultDto> ParseAsync(int documentId, BlueprintParseRequestDto request)
    {
        var doc = await db.ProjectDocuments.FindAsync(documentId)
            ?? throw new KeyNotFoundException("Document not found.");
        if (doc.Category != DocumentCategory.Blueprint)
            throw new InvalidOperationException("Only Blueprint files can be used to generate a BOQ.");

        var bytes = await documents.ReadFileBytesAsync(doc.StoragePath);
        using var content = new MultipartFormDataContent { { new ByteArrayContent(bytes), "file", doc.FileName } };
        if (!string.IsNullOrWhiteSpace(request.Sheet)) content.Add(new StringContent(request.Sheet), "sheet");
        if (!string.IsNullOrWhiteSpace(request.DrawingId)) content.Add(new StringContent(request.DrawingId), "drawing_id");
        if (!string.IsNullOrWhiteSpace(request.ScaleOverride)) content.Add(new StringContent(request.ScaleOverride), "scale_override");

        return await CallMl<BlueprintResultDto>(() => Ml.PostAsync("/documents/parse-blueprint", content), "read the blueprint");
    }

    public Task<FinishTemplatesDto> GetTemplatesAsync() =>
        CallMl<FinishTemplatesDto>(() => Ml.GetAsync("/boq/templates"), "load the finish templates");

    public async Task<GeneratedBoqDto> GenerateAsync(GenerateFromBlueprintDto request)
    {
        // The catalog with its physical properties — the ML service matches
        // template rows to it by name and computes each row's baseline.
        var materials = await db.Materials.Where(m => m.IsActive).Select(m => new
        {
            id = m.Id, name = m.Name, unit = m.Unit,
            calculation_type = m.CalculationType.HasValue ? m.CalculationType.Value.ToString() : null,
            length_mm = m.LengthMm, width_mm = m.WidthMm, thickness_mm = m.ThicknessMm,
            pieces_per_package = m.PiecesPerPackage, coverage_per_unit = m.CoveragePerUnit,
            coverage_unit = m.CoverageUnit, unit_length_m = m.UnitLengthM, coats = m.Coats,
            purchase_unit = m.PurchaseUnit,
        }).ToListAsync();

        var payload = new
        {
            measurements = request.Measurements.Select(m => new
            {
                room = m.Room, floor_area_sqm = m.FloorAreaSqm, perimeter_m = m.PerimeterM,
                height_m = m.HeightM, openings_sqm = m.OpeningsSqm,
                ceiling_notes = m.CeilingNotes.Select(Note), has_ceiling_plan = m.HasCeilingPlan,
                glass_length_m = m.GlassLengthM, height_note = m.HeightNote,
            }),
            finishes = request.Finishes.Select(f => new { room = f.Room, floor = f.Floor, wall = f.Wall, ceiling = f.Ceiling }),
            openings = request.Openings.Select(o => new { type = o.Type, count = o.Count, width_m = o.WidthM, height_m = o.HeightM }),
            materials,
            source = request.Source,
            per_room_floor = request.PerRoomFloor,
            plan_notes = request.PlanNotes.Select(Note),
        };
        return await CallMl<GeneratedBoqDto>(() => Ml.PostAsJsonAsync("/boq/generate", payload), "generate the BOQ");
    }

    private static object Note(BlueprintNoteDto n) => new { text = n.Text, page = n.Page, box = n.Box };

    // ── Saved reads ──────────────────────────────────────────────────────────

    public async Task<BlueprintReadDto> SaveReadAsync(BlueprintReadCreateDto request, int userId)
    {
        var doc = await db.ProjectDocuments.FindAsync(request.DocumentId)
            ?? throw new KeyNotFoundException("Document not found.");
        if (doc.ProjectId != request.ProjectId)
            throw new InvalidOperationException("That blueprint belongs to a different project.");
        var read = new BlueprintRead
        {
            ProjectId = request.ProjectId, DocumentId = request.DocumentId,
            ReadJson = request.Read, CreatedByUserId = userId,
        };
        db.BlueprintReads.Add(read);
        await db.SaveChangesAsync();
        return ToDto(read, doc.FileName);
    }

    public async Task<BlueprintReadDto?> GetReadAsync(int id)
    {
        var read = await db.BlueprintReads.Include(r => r.Document).FirstOrDefaultAsync(r => r.Id == id);
        return read is null ? null : ToDto(read, read.Document.FileName);
    }

    private static BlueprintReadDto ToDto(BlueprintRead r, string fileName) => new()
    {
        Id = r.Id, ProjectId = r.ProjectId, DocumentId = r.DocumentId, FileName = fileName,
        Read = r.ReadJson, CreatedAt = r.CreatedAt,
    };

    // ── Pages, for the plan viewer ───────────────────────────────────────────

    // Rendered pages are kept on disk: a page is rendered once per width.
    private static readonly string PageCache = Path.Combine(Path.GetTempPath(), "constructiq-blueprint-pages");
    private static readonly int[] PageWidths = [900, 1400, 2200, 3600, 5000];

    private async Task<ProjectDocument> BlueprintPdf(int documentId)
    {
        var doc = await db.ProjectDocuments.FindAsync(documentId)
            ?? throw new KeyNotFoundException("Document not found.");
        if (doc.Category != DocumentCategory.Blueprint || !doc.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Only a PDF blueprint has pages to show.");
        return doc;
    }

    public async Task<BlueprintPagesDto> GetPagesAsync(int documentId)
    {
        var doc = await BlueprintPdf(documentId);
        var cached = Path.Combine(PageCache, $"{doc.Id}-{CacheStamp(doc)}.json");
        if (File.Exists(cached))
            return System.Text.Json.JsonSerializer.Deserialize<BlueprintPagesDto>(await File.ReadAllTextAsync(cached)) ?? new();
        var bytes = await documents.ReadFileBytesAsync(doc.StoragePath);
        using var content = new MultipartFormDataContent { { new ByteArrayContent(bytes), "file", doc.FileName } };
        var pages = await CallMl<BlueprintPagesDto>(() => Ml.PostAsync("/documents/page-info", content), "read the pages of the blueprint");
        Directory.CreateDirectory(PageCache);
        await File.WriteAllTextAsync(cached, System.Text.Json.JsonSerializer.Serialize(pages));
        return pages;
    }

    public async Task<byte[]> RenderPageAsync(int documentId, int page, int width)
    {
        var doc = await BlueprintPdf(documentId);
        // Only a few widths, so the cache stays small.
        width = PageWidths.FirstOrDefault(w => w >= width, PageWidths[^1]);
        var cached = Path.Combine(PageCache, $"{doc.Id}-{CacheStamp(doc)}-{page}-{width}.png");
        if (File.Exists(cached)) return await File.ReadAllBytesAsync(cached);

        var bytes = await documents.ReadFileBytesAsync(doc.StoragePath);
        using var content = new MultipartFormDataContent
        {
            { new ByteArrayContent(bytes), "file", doc.FileName },
            { new StringContent(page.ToString()), "page" },
            { new StringContent(width.ToString()), "width" },
        };
        HttpResponseMessage response;
        try { response = await Ml.PostAsync("/documents/render-page", content); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogError(ex, "ML service call failed: render a blueprint page.");
            throw new InvalidOperationException("Couldn't show the blueprint — the forecasting service didn't respond.");
        }
        using (response)
        {
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound) throw new KeyNotFoundException("No such page.");
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Couldn't show the blueprint (service error {(int)response.StatusCode}).");
            var png = await response.Content.ReadAsByteArrayAsync();
            Directory.CreateDirectory(PageCache);
            await File.WriteAllBytesAsync(cached, png);
            return png;
        }
    }

    // A re-uploaded file under the same id gets fresh pages.
    private static string CacheStamp(ProjectDocument doc) =>
        Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(doc.StoragePath)))[..12];

    public async Task<MergePreviewDto> MergePreviewAsync(MergePreviewRequestDto request)
    {
        var doc = await db.ProjectDocuments.FindAsync(request.DocumentId)
            ?? throw new KeyNotFoundException("Document not found.");
        if (doc.ProjectId != request.ProjectId)
            throw new InvalidOperationException("That BOQ file belongs to a different project.");
        if (doc.Category != DocumentCategory.BOQ)
            throw new InvalidOperationException("Pick a BOQ file to merge.");

        // The existing BOQ scanner, unchanged.
        var parsed = await documents.ParseAsync(request.DocumentId);
        var scanned = parsed.Items.Select(i => new MergeScannedRowDto
        {
            MaterialName = i.MaterialName, Specification = i.Specification, Unit = i.Unit,
            EstimatedQuantity = i.EstimatedQuantity, PrimarySection = i.PrimarySection,
            SubCategory = i.SubCategory, MatchedMaterialId = i.MatchedMaterialId,
        });
        return new MergePreviewDto { Rows = BoqMerge.Preview(request.Rows, scanned), ParseErrors = parsed.ParseErrors };
    }

    private async Task<T> CallMl<T>(Func<Task<HttpResponseMessage>> call, string what) where T : new()
    {
        HttpResponseMessage response;
        try
        {
            response = await call();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogError(ex, "ML service call failed: {What}.", what);
            throw new InvalidOperationException($"Couldn't {what} — the forecasting service didn't respond. Make sure it's running and try again.");
        }
        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                logger.LogError("ML service returned {Status} trying to {What}.", (int)response.StatusCode, what);
                throw new InvalidOperationException($"Couldn't {what} (service error {(int)response.StatusCode}).");
            }
            return await response.Content.ReadFromJsonAsync<T>(ForecastService.MlJson) ?? new T();
        }
    }
}
