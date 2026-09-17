using System.Security.Claims;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/documents")]
[Authorize]
public class DocumentsController(IDocumentService documentService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpPost("upload")]
    [RequestSizeLimit(26_214_400)] // 25 MB
    public async Task<IActionResult> Upload([FromForm] IFormFile file, [FromForm] int projectId, [FromForm] string category)
    {
        try
        {
            var result = await documentService.UploadAsync(file, projectId, category, CurrentUserId);
            return Ok(result);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await documentService.GetByProjectAsync(projectId));

    [HttpPost("{id:int}/parse")]
    public async Task<IActionResult> Parse(int id)
    {
        try
        {
            return Ok(await documentService.ParseAsync(id));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("{id:int}/parse-measurements")]
    public async Task<IActionResult> ParseMeasurements(int id)
    {
        try
        {
            return Ok(await documentService.ParseMeasurementsAsync(id));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var deleted = await documentService.DeleteAsync(id);
        return deleted ? NoContent() : NotFound();
    }
}
