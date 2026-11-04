using ConstructIQ.API.Models.DTOs.Blueprint;

namespace ConstructIQ.API.Services.Interfaces;

public interface IBlueprintService
{
    // Extraction for a stored Blueprint document. Throws KeyNotFoundException
    // (no such document) or InvalidOperationException (wrong category / ML failure).
    Task<BlueprintResultDto> ParseAsync(int documentId, BlueprintParseRequestDto request);
    Task<FinishTemplatesDto> GetTemplatesAsync();
    Task<GeneratedBoqDto> GenerateAsync(GenerateFromBlueprintDto request);
    Task<MergePreviewDto> MergePreviewAsync(MergePreviewRequestDto request);
    // A read added to the Material Plan, kept so its rows can be shown on the plan.
    Task<BlueprintReadDto> SaveReadAsync(BlueprintReadCreateDto request, int userId);
    Task<BlueprintReadDto?> GetReadAsync(int id);
    // A PDF blueprint's page sizes (PDF points) and its pages as PNG images.
    Task<BlueprintPagesDto> GetPagesAsync(int documentId);
    Task<byte[]> RenderPageAsync(int documentId, int page, int width);
}
