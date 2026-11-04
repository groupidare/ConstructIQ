using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.WarehouseStock;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/warehouse-stock")]
[Authorize]
public class WarehouseStockController(IWarehouseStockService warehouseStockService, IProjectAccessService projectAccess) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    private string CurrentRole =>
        User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;

    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await warehouseStockService.GetAllAsync());

    // For deciding whether to order: refreshes a stale snapshot from the sheet
    // first, for any role — unlike the manual sync below.
    [HttpGet("current")]
    public async Task<IActionResult> GetCurrent() =>
        Ok(await warehouseStockService.GetCurrentAsync());

    [HttpGet("links")]
    public async Task<IActionResult> GetLinks() =>
        Ok(await warehouseStockService.GetLinksAsync());

    [HttpPut("links")]
    public async Task<IActionResult> SaveLink([FromBody] WarehouseStockLinkSaveDto dto)
    {
        if (!await projectAccess.CanEditProjectAsync(dto.ProjectId, CurrentUserId, CurrentRole))
            return Forbid();
        try
        {
            return Ok(await warehouseStockService.SaveLinkAsync(dto.BoqName, dto.WarehouseMaterialName));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("links")]
    public async Task<IActionResult> RemoveLink([FromQuery] int projectId, [FromQuery] string boqName)
    {
        if (!await projectAccess.CanEditProjectAsync(projectId, CurrentUserId, CurrentRole))
            return Forbid();
        await warehouseStockService.RemoveLinkAsync(boqName);
        return NoContent();
    }

    [HttpPost("sync")]
    [Authorize(Roles = "Admin,WarehousePersonnel")]
    public async Task<IActionResult> Sync()
    {
        try
        {
            return Ok(await warehouseStockService.SyncFromGoogleSheetAsync());
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
