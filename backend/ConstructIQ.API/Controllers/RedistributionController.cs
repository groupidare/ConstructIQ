using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Procurement;
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

    [HttpPost("{id:int}/reject")]
    [Authorize(Roles = "Admin,ProjectManager,WarehousePersonnel")]
    public async Task<IActionResult> Reject(int id)
    {
        var success = await redistributionService.RejectTransferAsync(id, CurrentUserId);
        return success ? Ok(new { message = "Transfer rejected." }) : NotFound();
    }

    [HttpPost("{id:int}/cancel-approval")]
    [Authorize(Roles = "Admin,ProjectManager,WarehousePersonnel")]
    public async Task<IActionResult> CancelApproval(int id)
    {
        var success = await redistributionService.CancelApprovalAsync(id);
        return success ? Ok(new { message = "Approval cancelled." }) : NotFound();
    }

    [HttpGet("suggest-targets/{excessWasteRecordId:int}")]
    public async Task<IActionResult> SuggestTargets(int excessWasteRecordId)
    {
        try
        {
            return Ok(await redistributionService.SuggestTargetsAsync(excessWasteRecordId));
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { message = ex.Message });
        }
    }

    [HttpGet("received/{projectId:int}")]
    public async Task<IActionResult> GetReceived(int projectId) =>
        Ok(await redistributionService.GetReceivedQuantitiesAsync(projectId));

    [HttpPost("from-excess")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer,WarehousePersonnel")]
    public async Task<IActionResult> CreateFromExcess([FromBody] RedistributeFromExcessDto dto)
    {
        try
        {
            var created = await redistributionService.CreateFromExcessRecordAsync(dto, CurrentUserId);
            return Ok(created);
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
