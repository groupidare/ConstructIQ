using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ProjectsController(IProjectService projectService, IProjectAccessService projectAccess) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    private string CurrentRole =>
        User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;

    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await projectService.GetAllAsync(CurrentUserId, CurrentRole));

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var project = await projectService.GetByIdAsync(id);
        return project is null ? NotFound() : Ok(project);
    }

    [HttpPost]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Create([FromBody] ProjectCreateDto dto)
    {
        var created = await projectService.CreateAsync(dto, CurrentUserId, CurrentRole);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Update(int id, [FromBody] ProjectCreateDto dto)
    {
        if (!await projectAccess.CanEditProjectAsync(id, CurrentUserId, CurrentRole))
            return Forbid();
        var updated = await projectService.UpdateAsync(id, dto);
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var deleted = await projectService.DeleteAsync(id);
        return deleted ? NoContent() : NotFound();
    }

    [HttpGet("{id:int}/progress-updates")]
    public async Task<IActionResult> GetProgressUpdates(int id) =>
        Ok(await projectService.GetProgressUpdatesAsync(id));

    // Same roles as create/update — whoever can manage a project's details
    // can also log its on-site progress. WarehousePersonnel/ProcurementOfficer
    // don't touch construction progress at all.
    [HttpPost("{id:int}/progress-updates")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> LogProgress(int id, [FromForm] SubmitProgressUpdateDto dto)
    {
        if (!await projectAccess.CanEditProjectAsync(id, CurrentUserId, CurrentRole))
            return Forbid();
        try
        {
            var result = await projectService.LogProgressAsync(id, dto, CurrentUserId);
            return result is null ? NotFound() : Ok(result);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
