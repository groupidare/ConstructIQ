using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Forecast;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ForecastController(IForecastService forecastService, IProjectAccessService projectAccess) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    private string CurrentRole =>
        User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;

    [HttpPost("generate")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Generate([FromBody] ForecastRequestDto request)
    {
        if (!await projectAccess.CanEditProjectAsync(request.ProjectId, CurrentUserId, CurrentRole))
            return Forbid();
        try
        {
            return Ok(await forecastService.GenerateForecastAsync(request, CurrentUserId));
        }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await forecastService.GetByProjectAsync(projectId));

    [HttpGet("accuracy/{projectId:int}")]
    public async Task<IActionResult> GetAccuracy(int projectId) =>
        Ok(await forecastService.GetAccuracyReportAsync(projectId));

    [HttpPost("train")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Train()
    {
        try
        {
            return Ok(await forecastService.TrainModelsAsync());
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
