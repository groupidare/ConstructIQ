using ConstructIQ.API.Models.DTOs.Phase;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/phases")]
[Authorize]
public class PhasesController(IPhaseService phaseService) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] AddPhaseDto dto)
    {
        try
        {
            return Ok(await phaseService.CreateAsync(dto));
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var deleted = await phaseService.DeleteAsync(id);
        return deleted ? NoContent() : NotFound();
    }
}
