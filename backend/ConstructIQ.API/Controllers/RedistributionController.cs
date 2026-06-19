using System.Security.Claims;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RedistributionController(IRedistributionService redistributionService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet]
    public async Task<IActionResult> GetRecommendations() =>
        Ok(await redistributionService.GetRecommendationsAsync());

    [HttpPost("generate")]
    [Authorize(Roles = "Admin,ProjectManager")]
    public async Task<IActionResult> Generate()
    {
        await redistributionService.GenerateRecommendationsAsync();
        return Ok(new { message = "Redistribution recommendations generated." });
    }

    [HttpPost("{id:int}/approve")]
    [Authorize(Roles = "Admin,ProjectManager,WarehousePersonnel")]
    public async Task<IActionResult> Approve(int id)
    {
        var success = await redistributionService.ApproveTransferAsync(id, CurrentUserId);
        return success ? Ok(new { message = "Transfer approved." }) : NotFound();
    }
}
