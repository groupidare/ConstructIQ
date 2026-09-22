using ConstructIQ.API.Models.DTOs.Document;
using Microsoft.AspNetCore.Http;

namespace ConstructIQ.API.Services.Interfaces;

public interface IDocumentService
{
    Task<ProjectDocumentDto> UploadAsync(IFormFile file, int projectId, string category, int userId, string? categoryOther = null, string? description = null);
    Task<IEnumerable<ProjectDocumentDto>> GetByProjectAsync(int projectId);
    Task<IEnumerable<ProjectDocumentDto>> GetAllAsync(int? projectId);
    Task<DocumentParseResultDto> ParseAsync(int documentId);
    Task<PoParseResultDto> ParsePOAsync(int documentId);
    Task<bool> DeleteAsync(int documentId);
}
