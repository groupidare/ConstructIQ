using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ProjectsController(IProjectService projectService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    private string CurrentRole =>
        User.FindFirst("role")?.Value ?? string.Empty;

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
    [Authorize(Roles = "Admin,ProjectManager")]
    public async Task<IActionResult> Create([FromBody] ProjectCreateDto dto)
    {
        var created = await projectService.CreateAsync(dto, CurrentUserId);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,ProjectManager")]
    public async Task<IActionResult> Update(int id, [FromBody] ProjectCreateDto dto)
    {
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
}
