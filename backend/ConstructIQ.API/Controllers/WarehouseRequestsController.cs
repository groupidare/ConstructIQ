using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/warehouse-requests")]
[Authorize]
public class WarehouseRequestsController(IWarehouseRequestService warehouseRequestService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await warehouseRequestService.GetAllAsync());

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await warehouseRequestService.GetByProjectAsync(projectId));

    [HttpPost]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Create([FromBody] WarehouseRequestCreateDto dto)
    {
        try
        {
            var created = await warehouseRequestService.CreateAsync(dto, CurrentUserId);
            return Ok(created);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{id:int}/approve")]
    [Authorize(Roles = "Admin,WarehousePersonnel")]
    public async Task<IActionResult> Approve(int id, [FromBody] WarehouseRequestApproveDto dto)
    {
        try
        {
            var success = await warehouseRequestService.ApproveAsync(id, dto.ApprovedQuantity, CurrentUserId);
            return success ? Ok(new { message = "Request approved." }) : NotFound();
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{id:int}/reject")]
    [Authorize(Roles = "Admin,WarehousePersonnel")]
    public async Task<IActionResult> Reject(int id)
    {
        var success = await warehouseRequestService.RejectAsync(id, CurrentUserId);
        return success ? Ok(new { message = "Request rejected." }) : NotFound();
    }
}
