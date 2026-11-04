using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.ExcessWaste;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/excess-waste")]
[Authorize]
public class ExcessWasteController(IExcessWasteService excessWasteService, IMaterialCostService materialCost) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    // Same price visibility as PurchaseOrdersController.CanSeePrices.
    private bool CanSeePrices => User.IsInRole("Admin") || User.IsInRole("ProcurementOfficer");

    // ₱ value of logged excess and waste, across every project unless
    // projectId is given. ProjectManager gets the totals only; the
    // per-material breakdown (which reveals unit prices) is for the roles
    // that may see prices.
    [HttpGet("cost-impact")]
    [Authorize(Roles = "Admin,ProjectManager,ProcurementOfficer")]
    public async Task<IActionResult> GetCostImpact([FromQuery] int? projectId) =>
        Ok(await materialCost.GetExcessCostImpactAsync(projectId, CanSeePrices));

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await excessWasteService.GetByProjectAsync(projectId));

    [HttpGet("summary/{projectId:int}")]
    public async Task<IActionResult> GetSummary(int projectId) =>
        Ok(await excessWasteService.GetSummaryAsync(projectId));

    [HttpGet("boq-items/{projectId:int}")]
    public async Task<IActionResult> GetLoggableBOQItems(int projectId) =>
        Ok(await excessWasteService.GetLoggableBOQItemsAsync(projectId));

    [HttpGet("projects-with-boq-items")]
    public async Task<IActionResult> GetProjectIdsWithBOQItems() =>
        Ok(await excessWasteService.GetProjectIdsWithBOQItemsAsync());

    // "None" — these BOQ lines have no excess or waste left. Same roles as
    // logging an entry.
    [HttpPost("confirm-none")]
    [Authorize(Roles = "Admin,WarehousePersonnel")]
    public async Task<IActionResult> ConfirmNone([FromBody] ConfirmNoExcessWasteDto dto)
    {
        if (dto.BOQItemIds.Count == 0)
            return BadRequest(new { message = "Select at least one material." });
        try
        {
            await excessWasteService.ConfirmNoExcessWasteAsync(dto.ProjectId, dto.BOQItemIds, CurrentUserId);
            return NoContent();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // SiteEngineer's Excess Analytics access is view-only — only
    // Warehouse (and Admin) actually log/edit entries.
    [HttpPost]
    [Authorize(Roles = "Admin,WarehousePersonnel")]
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
    [Authorize(Roles = "Admin,WarehousePersonnel")]
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
