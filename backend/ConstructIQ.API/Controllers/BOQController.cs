using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.BOQ;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/boq")]
[Authorize]
public class BOQController(IBOQService boqService, IProjectAccessService projectAccess) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    private string CurrentRole =>
        User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await boqService.GetByProjectAsync(projectId));

    [HttpPost("bulk")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> BulkSave([FromBody] BOQBulkSaveDto dto)
    {
        if (!await projectAccess.CanEditProjectAsync(dto.ProjectId, CurrentUserId, CurrentRole))
            return Forbid();
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
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Delete(int id)
    {
        if (!await projectAccess.CanEditBoqItemAsync(id, CurrentUserId, CurrentRole))
            return Forbid();
        var deleted = await boqService.DeleteAsync(id);
        return deleted ? NoContent() : NotFound();
    }

    [HttpGet("historical-estimate")]
    public async Task<IActionResult> GetHistoricalEstimate([FromQuery] string primarySection, [FromQuery] string materialDescription, [FromQuery] string? projectType) =>
        Ok(await boqService.GetHistoricalEstimateAsync(primarySection, materialDescription, projectType));

    [HttpGet("monthly-demand-summary")]
    public async Task<IActionResult> GetMonthlyDemandSummary() =>
        Ok(await boqService.GetMonthlyDemandSummaryAsync());
}
