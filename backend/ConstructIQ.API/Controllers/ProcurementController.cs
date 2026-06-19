using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Procurement;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ProcurementController(IProcurementService procurementService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet("recommendations/{projectId:int}")]
    public async Task<IActionResult> GetRecommendations(int projectId) =>
        Ok(await procurementService.GetRecommendationsAsync(projectId));

    [HttpPost("recommendations/generate/{projectId:int}")]
    [Authorize(Roles = "Admin,ProjectManager")]
    public async Task<IActionResult> GenerateRecommendations(int projectId)
    {
        await procurementService.GenerateRecommendationsAsync(projectId);
        return Ok(new { message = "Procurement recommendations generated." });
    }

    [HttpPost("purchase-requests")]
    [Authorize(Roles = "Admin,ProjectManager,ProcurementOfficer")]
    public async Task<IActionResult> CreatePurchaseRequest([FromBody] PurchaseRequestCreateDto dto)
    {
        var result = await procurementService.CreatePurchaseRequestAsync(dto, CurrentUserId);
        return Ok(result);
    }

    [HttpPatch("purchase-requests/{requestId:int}/status")]
    [Authorize(Roles = "Admin,ProjectManager,ProcurementOfficer")]
    public async Task<IActionResult> UpdateStatus(int requestId, [FromBody] string status)
    {
        var result = await procurementService.UpdateRequestStatusAsync(requestId, status, CurrentUserId);
        return result is null ? NotFound() : Ok(result);
    }
}
