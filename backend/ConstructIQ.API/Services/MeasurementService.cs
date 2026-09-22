using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Measurement;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Services;

public class MeasurementService(AppDbContext db) : IMeasurementService
{
    public async Task<IEnumerable<MeasurementResponseDto>> GetByProjectAsync(int projectId)
    {
        var rows = await db.Measurements
            .Include(m => m.Phase)
            .Where(m => m.ProjectId == projectId)
            .OrderBy(m => m.Phase.Order)
            .ToListAsync();

        return rows.Select(ToDto);
    }

    public async Task<IEnumerable<MeasurementResponseDto>> BulkSaveAsync(int projectId, List<MeasurementUpsertDto> items, int userId)
    {
        var saved = new List<Measurement>();

        foreach (var item in items)
        {
            var elementType = Enum.Parse<ElementType>(item.ElementType, ignoreCase: true);
            var (area, volume) = ComputeAreaAndVolume(elementType, item.LengthM, item.WidthM, item.HeightM, item.ThicknessM);

            var entity = item.Id.HasValue
                ? await db.Measurements.FirstOrDefaultAsync(m => m.Id == item.Id && m.ProjectId == projectId)
                : null;

            if (entity is null)
            {
                entity = new Measurement { ProjectId = projectId, RecordedByUserId = userId };
                db.Measurements.Add(entity);
            }

            entity.PhaseId           = item.PhaseId;
            entity.ElementType       = elementType;
            entity.AreaLabel         = item.AreaLabel;
            entity.LengthM           = item.LengthM;
            entity.WidthM            = item.WidthM;
            entity.HeightM           = item.HeightM;
            entity.ThicknessM        = item.ThicknessM;
            entity.AreaSqm           = area;
            entity.VolumeCbm         = volume;
            entity.ConcreteMixRatio  = item.ConcreteMixRatio;
            entity.WasteAllowancePct = item.WasteAllowancePct;
            entity.RecordedAt        = DateTime.UtcNow;

            saved.Add(entity);
        }

        await db.SaveChangesAsync();

        var ids = saved.Select(s => s.Id).ToList();
        var reloaded = await db.Measurements.Include(m => m.Phase).Where(m => ids.Contains(m.Id)).ToListAsync();
        return reloaded.Select(ToDto);
    }

    // Wall: area = length × height (the face you see), volume = area × thickness.
    // Column/Beam/Slab/Footing: area = length × width (the footprint), volume = area × thickness.
    private static (decimal area, decimal volume) ComputeAreaAndVolume(
        ElementType type, decimal length, decimal width, decimal height, decimal thickness)
    {
        var area = type == ElementType.Wall ? length * height : length * width;
        var volume = area * thickness;
        return (area, volume);
    }

    private static MeasurementResponseDto ToDto(Measurement m) => new()
    {
        Id                = m.Id,
        ProjectId         = m.ProjectId,
        PhaseId           = m.PhaseId,
        PhaseName         = m.Phase.Name,
        ElementType       = m.ElementType.ToString(),
        AreaLabel         = m.AreaLabel,
        LengthM           = m.LengthM,
        WidthM            = m.WidthM,
        HeightM           = m.HeightM,
        ThicknessM        = m.ThicknessM,
        AreaSqm           = m.AreaSqm,
        VolumeCbm         = m.VolumeCbm,
        ConcreteMixRatio  = m.ConcreteMixRatio,
        WasteAllowancePct = m.WasteAllowancePct,
        RecordedAt        = m.RecordedAt,
    };
}
