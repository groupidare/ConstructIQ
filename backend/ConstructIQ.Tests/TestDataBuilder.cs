using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;

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
        DateTime? startDate = null, ProjectStatus status = ProjectStatus.Active, bool isHistorical = false, int? siteEngineerId = null)
    {
        var project = new Project
        {
            Name = "Project " + Guid.NewGuid().ToString("N")[..8],
            Type = ProjectType.Residential,
            Location = "Test Site",
            Budget = 100000,
            StartDate = startDate ?? DateTime.UtcNow,
            TargetEndDate = (startDate ?? DateTime.UtcNow).AddMonths(6),
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
        decimal estimatedQuantity, string? unit = null, decimal? estimatedPurchaseQuantity = null, string? estimatedPurchaseUnit = null)
    {
        var item = new BOQItem
        {
            ProjectId = projectId,
            MaterialId = materialId,
            Unit = unit ?? "sq.m",
            EstimatedQuantity = estimatedQuantity,
            EstimatedPurchaseQuantity = estimatedPurchaseQuantity,
            EstimatedPurchaseUnit = estimatedPurchaseUnit,
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

    public static async Task<ForecastResult> CreateForecastResultAsync(AppDbContext db, int projectId, DateTime generatedAt)
    {
        var result = new ForecastResult { ProjectId = projectId, Period = ForecastPeriod.Monthly, GeneratedAt = generatedAt };
        db.ForecastResults.Add(result);
        await db.SaveChangesAsync();
        return result;
    }

    public static async Task AddForecastedMaterialAsync(AppDbContext db, int forecastResultId, int materialId, decimal quantity)
    {
        db.ForecastedMaterials.Add(new ForecastedMaterial
        {
            ForecastResultId = forecastResultId, MaterialId = materialId,
            ForecastedQuantity = quantity, CurrentStock = 0, Shortage = 0, ReorderSuggestion = 0,
            RiskLevel = RiskLevel.Low,
        });
        await db.SaveChangesAsync();
    }
}
