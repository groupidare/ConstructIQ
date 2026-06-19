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

    [HttpPost]
    [Authorize(Roles = "Admin,SiteEngineer,WarehousePersonnel")]
    public async Task<IActionResult> Create([FromBody] ExcessWasteCreateDto dto)
    {
        var created = await excessWasteService.CreateAsync(dto, CurrentUserId);
        return Ok(created);
    }
}
