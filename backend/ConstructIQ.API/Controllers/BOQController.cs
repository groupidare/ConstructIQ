using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/boq")]
[Authorize]
public class BOQController(IBOQService boqService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await boqService.GetByProjectAsync(projectId));

    [HttpPost("bulk")]
    public async Task<IActionResult> BulkSave([FromBody] BOQBulkSaveDto dto)
    {
        try
        {
            return Ok(await boqService.BulkSaveAsync(dto.ProjectId, dto.Items, CurrentUserId));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var deleted = await boqService.DeleteAsync(id);
        return deleted ? NoContent() : NotFound();
    }
}
