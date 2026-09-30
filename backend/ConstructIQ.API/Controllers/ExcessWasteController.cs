using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/excess-waste")]
[Authorize]
public class ExcessWasteController(IExcessWasteService excessWasteService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await excessWasteService.GetByProjectAsync(projectId));

    [HttpGet("summary/{projectId:int}")]
    public async Task<IActionResult> GetSummary(int projectId) =>
        Ok(await excessWasteService.GetSummaryAsync(projectId));

    [HttpGet("pending-boq-items/{projectId:int}")]
    public async Task<IActionResult> GetPendingBOQItems(int projectId, [FromQuery] bool isReusable = true) =>
        Ok(await excessWasteService.GetPendingBOQItemsAsync(projectId, isReusable));

    [HttpGet("projects-with-pending-items")]
    public async Task<IActionResult> GetProjectIdsWithPendingItems() =>
        Ok(await excessWasteService.GetProjectIdsWithPendingItemsAsync());

    [HttpPost]
    [Authorize(Roles = "Admin,SiteEngineer,WarehousePersonnel")]
    public async Task<IActionResult> Create([FromBody] ExcessWasteCreateDto dto)
    {
        try
        {
            var created = await excessWasteService.CreateAsync(dto, CurrentUserId);
            return Ok(created);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,SiteEngineer,WarehousePersonnel")]
    public async Task<IActionResult> Update(int id, [FromBody] ExcessWasteUpdateDto dto)
    {
        try
        {
            var updated = await excessWasteService.UpdateAsync(id, dto);
            return Ok(updated);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,SiteEngineer,WarehousePersonnel")]
    public async Task<IActionResult> Delete(int id)
    {
        try
        {
            await excessWasteService.DeleteAsync(id);
            return NoContent();
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
