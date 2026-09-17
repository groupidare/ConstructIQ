using System.Security.Claims;
using ConstructIQ.API.Models.DTOs.Measurement;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/measurements")]
[Authorize]
public class MeasurementsController(IMeasurementService measurementService) : ControllerBase
{
    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet("project/{projectId:int}")]
    public async Task<IActionResult> GetByProject(int projectId) =>
        Ok(await measurementService.GetByProjectAsync(projectId));

    [HttpPost("bulk")]
    public async Task<IActionResult> BulkSave([FromBody] MeasurementBulkSaveDto dto) =>
        Ok(await measurementService.BulkSaveAsync(dto.ProjectId, dto.Items, CurrentUserId));
}
