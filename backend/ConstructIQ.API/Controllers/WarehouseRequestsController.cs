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

    [HttpPost]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Create([FromBody] WarehouseRequestCreateDto dto)
    {
        var created = await warehouseRequestService.CreateAsync(dto, CurrentUserId);
        return Ok(created);
    }

    [HttpPost("{id:int}/approve")]
    [Authorize(Roles = "Admin,WarehousePersonnel")]
    public async Task<IActionResult> Approve(int id)
    {
        var success = await warehouseRequestService.ApproveAsync(id, CurrentUserId);
        return success ? Ok(new { message = "Request approved." }) : NotFound();
    }
}
