using System.Net.Http.Json;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Blueprint;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

// Blueprint → measurements → generated BOQ, by proxy to the ML service.
// Nothing here saves anything: extraction, generation and the merge preview
// are all previews; the wizard saves what the user confirms through the
// existing /api/measurements/bulk and /api/boq/bulk.
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
            }),
            finishes = request.Finishes.Select(f => new { room = f.Room, floor = f.Floor, wall = f.Wall, ceiling = f.Ceiling }),
            openings = request.Openings.Select(o => new { type = o.Type, count = o.Count, width_m = o.WidthM, height_m = o.HeightM }),
            materials,
            source = request.Source,
            per_room_floor = request.PerRoomFloor,
        };
        return await CallMl<GeneratedBoqDto>(() => Ml.PostAsJsonAsync("/boq/generate", payload), "generate the BOQ");
    }

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
