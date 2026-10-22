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
}
