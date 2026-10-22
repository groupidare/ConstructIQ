using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Material;
using ConstructIQ.API.Models.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

// The catalog with its physical properties (which feed the engineering
// baseline). Reading is open to any signed-in user; editing is Admin-only.
[ApiController]
[Route("api/materials")]
[Authorize]
public class MaterialsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var materials = await db.Materials.Include(m => m.Category).OrderBy(m => m.Name).ToListAsync();
        return Ok(materials.Select(ToDto));
    }

    [HttpPut("{id:int}/properties")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> UpdateProperties(int id, [FromBody] MaterialPropertiesDto dto)
    {
        var material = await db.Materials.Include(m => m.Category).FirstOrDefaultAsync(m => m.Id == id);
        if (material is null) return NotFound();

        MaterialCalculationType? type = null;
        if (!string.IsNullOrWhiteSpace(dto.CalculationType))
        {
            if (!Enum.TryParse<MaterialCalculationType>(dto.CalculationType, true, out var parsed) || !Enum.IsDefined(parsed))
                return BadRequest(new { message = "Calculation type must be UnitArea, CoverageRate, Volume, Count or Length." });
            type = parsed;
        }

        // The fields each type actually needs — otherwise the baseline would
        // just come back "no properties" with no hint why.
        var missing = type switch
        {
            MaterialCalculationType.UnitArea when dto.LengthMm is null || dto.WidthMm is null => "Length and width (mm)",
            MaterialCalculationType.CoverageRate or MaterialCalculationType.Volume when dto.CoveragePerUnit is null => "Coverage per unit",
            MaterialCalculationType.Length when dto.UnitLengthM is null => "Unit length (m)",
            _ => null,
        };
        if (missing is not null)
            return BadRequest(new { message = $"{missing} is required for {type}." });

        material.CalculationType  = type;
        material.LengthMm         = dto.LengthMm;
        material.WidthMm          = dto.WidthMm;
        material.ThicknessMm      = dto.ThicknessMm;
        material.PiecesPerPackage = dto.PiecesPerPackage;
        material.CoveragePerUnit  = dto.CoveragePerUnit;
        material.CoverageUnit     = Clean(dto.CoverageUnit);
        material.UnitLengthM      = dto.UnitLengthM;
        material.Coats            = dto.Coats;
        material.PurchaseUnit     = Clean(dto.PurchaseUnit);
        material.PropertiesSource = Clean(dto.PropertiesSource);
        await db.SaveChangesAsync();
        return Ok(ToDto(material));
    }

    // Fills typical properties for common materials (CHB, tiles, boards,
    // adhesive, grout, paint, cement, sand, gravel, rebar, doors/windows) —
    // only on materials that have none yet.
    [HttpPost("properties/apply-defaults")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> ApplyDefaults()
    {
        var materials = await db.Materials.Where(m => m.CalculationType == null).ToListAsync();
        var updated = materials.Where(MaterialPropertyDefaults.TryApply).Select(m => m.Name).ToList();
        await db.SaveChangesAsync();
        return Ok(new ApplyDefaultsResultDto { Updated = updated.Count, Materials = updated });
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    internal static MaterialResponseDto ToDto(Material m) => new()
    {
        Id = m.Id, Name = m.Name, Specification = m.Specification, Unit = m.Unit,
        CategoryName = m.Category?.Name ?? string.Empty, IsActive = m.IsActive,
        Properties = new MaterialPropertiesDto
        {
            CalculationType = m.CalculationType?.ToString(),
            LengthMm = m.LengthMm, WidthMm = m.WidthMm, ThicknessMm = m.ThicknessMm,
            PiecesPerPackage = m.PiecesPerPackage, CoveragePerUnit = m.CoveragePerUnit, CoverageUnit = m.CoverageUnit,
            UnitLengthM = m.UnitLengthM, Coats = m.Coats, PurchaseUnit = m.PurchaseUnit, PropertiesSource = m.PropertiesSource,
        },
    };
}
