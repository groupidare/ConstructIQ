using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Inventory;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class InventoryController(IInventoryService inventoryService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId, [FromQuery] bool inStockOnly = false) =>
        Ok(await inventoryService.GetByProjectAsync(projectId, inStockOnly));

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var record = await inventoryService.GetByIdAsync(id);
        return record is null ? NotFound() : Ok(record);
    }

    [HttpPost("movement")]
    [Authorize(Roles = "Admin,SiteEngineer,WarehousePersonnel")]
    public async Task<IActionResult> RecordMovement([FromBody] MovementCreateDto dto)
    {
        await inventoryService.RecordMovementAsync(dto, CurrentUserId);
        return Ok(new { message = "Movement recorded successfully." });
    }
}
