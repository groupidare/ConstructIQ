using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Phase;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/phases")]
[Authorize]
public class PhasesController(IPhaseService phaseService, IProjectAccessService projectAccess) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    private string CurrentRole =>
        User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;

    [HttpPost]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Create([FromBody] AddPhaseDto dto)
    {
        if (!await projectAccess.CanEditProjectAsync(dto.ProjectId, CurrentUserId, CurrentRole))
            return Forbid();
        try
        {
            return Ok(await phaseService.CreateAsync(dto));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Delete(int id)
    {
        if (!await projectAccess.CanEditPhaseAsync(id, CurrentUserId, CurrentRole))
            return Forbid();
        var deleted = await phaseService.DeleteAsync(id);
        return deleted ? NoContent() : NotFound();
    }
}
