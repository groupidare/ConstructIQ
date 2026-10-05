using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.Tests;

// Minimal, sensible-default row builders so each test only sets the fields
// it actually cares about.
public static class TestDataBuilder
{
    public static async Task<User> CreateUserAsync(AppDbContext db, UserRole role = UserRole.Admin)
    {
        var user = new User
        {
            Username = "user_" + Guid.NewGuid().ToString("N")[..8],
            Email = Guid.NewGuid().ToString("N")[..8] + "@example.test",
            PasswordHash = "not-a-real-hash",
            FirstName = "Test", LastName = "User", Role = role,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public static async Task<Project> CreateProjectAsync(AppDbContext db, int projectManagerId,
        DateTime? startDate = null, ProjectStatus status = ProjectStatus.Active, bool isHistorical = false, int? siteEngineerId = null,
        DateTime? targetEndDate = null)
    {
        var project = new Project
        {
            Name = "Project " + Guid.NewGuid().ToString("N")[..8],
            Type = ProjectType.Residential,
            Location = "Test Site",
            Budget = 100000,
            StartDate = startDate ?? DateTime.UtcNow,
            TargetEndDate = targetEndDate ?? (startDate ?? DateTime.UtcNow).AddMonths(6),
            ProjectManagerId = projectManagerId,
            SiteEngineerId = siteEngineerId,
            Status = status,
            IsHistorical = isHistorical,
        };
        db.Projects.Add(project);
        await db.SaveChangesAsync();
        return project;
    }

    public static async Task<Material> CreateMaterialAsync(AppDbContext db, string? unit = null)
    {
        var category = new MaterialCategory { Name = "Category " + Guid.NewGuid().ToString("N")[..8] };
        db.MaterialCategories.Add(category);
        await db.SaveChangesAsync();

        var material = new Material
        {
            Name = "Material " + Guid.NewGuid().ToString("N")[..8],
            Unit = unit ?? "sq.m",
            CategoryId = category.Id,
            UnitCost = 10,
        };
        db.Materials.Add(material);
        await db.SaveChangesAsync();
        return material;
    }

    public static async Task<BOQItem> CreateBoqItemAsync(AppDbContext db, int projectId, int materialId, int createdByUserId,
        decimal estimatedQuantity, string? unit = null, decimal? estimatedPurchaseQuantity = null, string? estimatedPurchaseUnit = null,
        decimal actualQuantity = 0)
    {
        var item = new BOQItem
        {
            ProjectId = projectId,
            MaterialId = materialId,
            Unit = unit ?? "sq.m",
            EstimatedQuantity = estimatedQuantity,
            EstimatedPurchaseQuantity = estimatedPurchaseQuantity,
            EstimatedPurchaseUnit = estimatedPurchaseUnit,
            ActualQuantity = actualQuantity,
            CreatedByUserId = createdByUserId,
        };
        db.BOQItems.Add(item);
        await db.SaveChangesAsync();
        return item;
    }

    public static async Task<ExcessWasteRecord> CreateExcessWasteRecordAsync(AppDbContext db, int projectId, int materialId,
        int boqItemId, int recordedByUserId, decimal quantity, bool isReusable, DateTime? recordedAt = null)
    {
        var record = new ExcessWasteRecord
        {
            ProjectId = projectId, MaterialId = materialId, BOQItemId = boqItemId,
            ExcessType = isReusable ? ExcessType.Overordered : ExcessType.Damaged,
            Quantity = quantity, UnitCost = 10, TotalCost = quantity * 10,
            IsReusable = isReusable, RecordedByUserId = recordedByUserId,
            RecordedAt = recordedAt ?? DateTime.UtcNow,
        };
        db.ExcessWasteRecords.Add(record);
        await db.SaveChangesAsync();
        return record;
    }

    public static async Task<ForecastResult> CreateForecastResultAsync(AppDbContext db, int projectId, DateTime generatedAt, int? phaseId = null, string? notes = null)
    {
        var result = new ForecastResult { ProjectId = projectId, PhaseId = phaseId, Period = ForecastPeriod.Monthly, GeneratedAt = generatedAt, Notes = notes };
        db.ForecastResults.Add(result);
        await db.SaveChangesAsync();
        return result;
    }

    public static async Task CreateProgressUpdateAsync(AppDbContext db, int projectId, int updatedByUserId, int progress, DateTime createdAt)
    {
        db.ProjectProgressUpdates.Add(new ProjectProgressUpdate
        {
            ProjectId = projectId, Progress = progress, Notes = "Test update",
            UpdatedByUserId = updatedByUserId, CreatedAt = createdAt,
        });
        await db.SaveChangesAsync();
    }

    // Flips a project to Completed after its data was logged the normal way
    // (the Forecasting chart only shows finished projects).
    public static async Task CompleteProjectAsync(AppDbContext db, int projectId)
    {
        var project = await db.Projects.FindAsync(projectId);
        project!.Status = ProjectStatus.Completed;
        await db.SaveChangesAsync();
    }

    public static async Task<Phase> CreatePhaseAsync(AppDbContext db, int projectId)
    {
        var phase = new Phase
        {
            ProjectId = projectId,
            Name = "Phase " + Guid.NewGuid().ToString("N")[..8],
            StartDate = DateTime.UtcNow,
            EndDate = DateTime.UtcNow.AddMonths(1),
        };
        db.Phases.Add(phase);
        await db.SaveChangesAsync();
        return phase;
    }

    public static async Task AddForecastedMaterialAsync(AppDbContext db, int forecastResultId, int materialId, decimal quantity, string? unit = null)
    {
        // Defaults to the catalog Material's own unit — same fallback used in
        // production (ForecastService/forecasting_service) when a row has no
        // unit of its own. Without this, every test fixture defaulted to ""
        // for Unit, which no longer matches the real unit on whatever it's
        // being compared against now that both sides key on it.
        // Pass `unit` ("" included) to override it.
        unit ??= await db.Materials.Where(m => m.Id == materialId).Select(m => m.Unit).FirstOrDefaultAsync() ?? string.Empty;
        db.ForecastedMaterials.Add(new ForecastedMaterial
        {
            ForecastResultId = forecastResultId, MaterialId = materialId, Unit = unit,
            ForecastedQuantity = quantity, CurrentStock = 0, Shortage = 0, ReorderSuggestion = 0,
            RiskLevel = RiskLevel.Low,
        });
        await db.SaveChangesAsync();
    }

    // One Delivered PO line on its own new PO — linked to a BOQ item when
    // boqItemId is given, else the unlinked Material/Phase-fallback kind.
    public static async Task<PurchaseOrderMaterial> CreateDeliveredPoLineAsync(AppDbContext db, int projectId, int createdByUserId,
        int materialId, decimal quantity, int? boqItemId = null, int? phaseId = null, string unit = "pcs")
    {
        var supplier = new Supplier { Name = "Supplier " + Guid.NewGuid().ToString("N")[..8] };
        db.Suppliers.Add(supplier);
        await db.SaveChangesAsync();

        var line = new PurchaseOrderMaterial
        {
            Name = "PO line", Quantity = quantity, Unit = unit,
            MaterialId = materialId, BOQItemId = boqItemId, PhaseId = phaseId,
        };
        db.PurchaseOrders.Add(new PurchaseOrder
        {
            Number = "PO-" + Guid.NewGuid().ToString("N")[..10],
            ProjectId = projectId, SupplierId = supplier.Id,
            Status = PurchaseOrderStatus.Delivered,
            ExpectedDate = DateTime.UtcNow, CreatedByUserId = createdByUserId,
            Materials = [line],
        });
        await db.SaveChangesAsync();
        return line;
    }
}
