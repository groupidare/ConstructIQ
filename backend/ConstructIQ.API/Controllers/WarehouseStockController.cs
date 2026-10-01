using ConstructIQ.API.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/warehouse-stock")]
[Authorize]
public class WarehouseStockController(IWarehouseStockService warehouseStockService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await warehouseStockService.GetAllAsync());

    [HttpPost("sync")]
    [Authorize(Roles = "Admin,WarehousePersonnel")]
    public async Task<IActionResult> Sync()
    {
        try
        {
            return Ok(await warehouseStockService.SyncFromGoogleSheetAsync());
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
