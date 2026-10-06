using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Forecast;
using ConstructIQ.API.Services;
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
        catch (ModelNotTrainedException ex) { return Conflict(new { code = "ModelNotTrained", message = ex.Message }); }
        catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await forecastService.GetByProjectAsync(projectId));

    [HttpGet("accuracy/{projectId:int}")]
    public async Task<IActionResult> GetAccuracy(int projectId) =>
        Ok(await forecastService.GetAccuracyReportAsync(projectId));

    [HttpGet("top-demand")]
    public async Task<IActionResult> GetTopDemand([FromQuery] string? unit) =>
        Ok(await forecastService.GetTopForecastedDemandAsync(unit));

    // Starts a background training run and returns at once (202) — poll
    // GET model-status for the outcome. One run at a time (409 otherwise).
    [HttpPost("train")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Train()
    {
        try
        {
            return Accepted(await forecastService.StartTrainingAsync());
        }
        catch (TrainingInProgressException ex)
        {
            return Conflict(new { code = "TrainingInProgress", message = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // Whether a trained model exists (and its training metadata), plus the
    // latest training run's state. Every role that can open the Forecasting
    // page sees it, so nobody mistakes an untrained state for real forecasts.
    [HttpGet("model-status")]
    public async Task<IActionResult> GetModelStatus() =>
        Ok(await forecastService.GetModelStatusAsync());

    // Which completed projects/rows the model can learn from, and why the
    // rest can't — Admin only, alongside the Retrain button.
    [HttpGet("training-data")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> GetTrainingData()
    {
        try
        {
            return Ok(await forecastService.GetTrainingDataReportAsync());
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
