using ConstructIQ.API.Models.DTOs.Forecast;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ForecastController(IForecastService forecastService) : ControllerBase
{
    [HttpPost("generate")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> Generate([FromBody] ForecastRequestDto request)
    {
        var result = await forecastService.GenerateForecastAsync(request);
        return Ok(result);
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await forecastService.GetByProjectAsync(projectId));

    [HttpGet("accuracy/{projectId:int}")]
    public async Task<IActionResult> GetAccuracy(int projectId) =>
        Ok(await forecastService.GetAccuracyReportAsync(projectId));
}
