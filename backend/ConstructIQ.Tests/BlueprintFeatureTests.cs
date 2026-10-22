using System.Reflection;
using System.Security.Claims;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Controllers;
using ConstructIQ.API.Models.DTOs.Blueprint;
using ConstructIQ.API.Models.DTOs.Material;
using ConstructIQ.API.Models.DTOs.Measurement;
using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// Blueprint → measurements → generated BOQ: endpoint roles and project
// access, the merge rules, the measurement area override, and the
// Admin-only material properties API.
[Collection("Database")]
public class BlueprintFeatureTests(DatabaseFixture fixture)
{
    // ── Roles on every new endpoint ─────────────────────────────────────────

    [Theory]
    [InlineData(typeof(DocumentsController), nameof(DocumentsController.ParseBlueprint), "Admin,ProjectManager,SiteEngineer")]
    [InlineData(typeof(BOQController), nameof(BOQController.GetTemplates), "Admin,ProjectManager,SiteEngineer")]
    [InlineData(typeof(BOQController), nameof(BOQController.GenerateFromBlueprint), "Admin,ProjectManager,SiteEngineer")]
    [InlineData(typeof(BOQController), nameof(BOQController.MergePreview), "Admin,ProjectManager,SiteEngineer")]
    [InlineData(typeof(MaterialsController), nameof(MaterialsController.UpdateProperties), "Admin")]
    [InlineData(typeof(MaterialsController), nameof(MaterialsController.ApplyDefaults), "Admin")]
    public void NewEndpoints_HaveTheAgreedRoles(Type controller, string action, string roles)
    {
        var attribute = controller.GetMethod(action)!.GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(roles, attribute?.Roles);
    }

    [Fact]
    public void MaterialCatalog_IsOpenToAnySignedInUser()
    {
        Assert.NotNull(typeof(MaterialsController).GetCustomAttribute<AuthorizeAttribute>());
        Assert.Null(typeof(MaterialsController).GetMethod(nameof(MaterialsController.GetAll))!.GetCustomAttribute<AuthorizeAttribute>());
    }

    // ── Project access (a Site Engineer only on assigned projects) ──────────

    [Fact]
    public async Task UnassignedSiteEngineer_IsForbiddenOnEveryProjectScopedEndpoint()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var other = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var doc = await CreateDocumentAsync(db, project.Id, admin.Id, DocumentCategory.Blueprint);

        var access = new ProjectAccessService(db);
        var documents = new DocumentsController(null!, access, null!) { ControllerContext = ContextFor(other) };
        var boq = new BOQController(null!, access, null!) { ControllerContext = ContextFor(other) };

        Assert.IsType<ForbidResult>(await documents.ParseBlueprint(doc.Id, new BlueprintParseRequestDto()));
        Assert.IsType<ForbidResult>(await boq.GenerateFromBlueprint(new GenerateFromBlueprintDto { ProjectId = project.Id }));
        Assert.IsType<ForbidResult>(await boq.MergePreview(new MergePreviewRequestDto { ProjectId = project.Id, DocumentId = doc.Id }));
    }

    [Fact]
    public async Task MergePreview_RejectsAFileFromAnotherProject()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var otherProject = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var doc = await CreateDocumentAsync(db, otherProject.Id, admin.Id, DocumentCategory.BOQ);

        var service = new BlueprintService(db, null!, null!, null!);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.MergePreviewAsync(new MergePreviewRequestDto { ProjectId = project.Id, DocumentId = doc.Id }));
    }

    [Fact]
    public async Task ParseBlueprint_OnlyAcceptsBlueprintFiles()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var doc = await CreateDocumentAsync(db, project.Id, admin.Id, DocumentCategory.BOQ);

        var service = new BlueprintService(db, null!, null!, null!);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ParseAsync(doc.Id, new BlueprintParseRequestDto()));
    }

    // ── Merge rules ──────────────────────────────────────────────────────────

    private static readonly List<MergeRowInputDto> Generated =
    [
        new() { MaterialId = 1, Specification = "Floor tile 600×600", BoqUnit = "sq.m", BoqQuantity = 63.1, SubCategory = "Floor Finish" },
        new() { MaterialId = 2, Specification = "Paint", BoqUnit = "sq.m", BoqQuantity = 120, SubCategory = "Wall Finish" },
    ];

    private static MergeScannedRowDto Scanned(int? materialId, decimal qty, string unit = "sq.m", string? sub = "Floor Finish") =>
        new() { MaterialName = "row", MatchedMaterialId = materialId, EstimatedQuantity = qty, Unit = unit, SubCategory = sub };

    [Fact]
    public void Merge_SameMaterialAndWorkItemWithin5Percent_IsSkipped()
    {
        var row = Assert.Single(BoqMerge.Preview(Generated, [Scanned(1, 65m, sub: "1.1 Floor finish")]));
        Assert.Equal(MergeActions.Skip, row.Action);
        Assert.Equal(0, row.GeneratedIndex);
    }

    [Fact]
    public void Merge_SameMaterialAndWorkItemOffByMoreThan5Percent_IsFlagged()
    {
        var row = Assert.Single(BoqMerge.Preview(Generated, [Scanned(1, 80m)]));
        Assert.Equal(MergeActions.Flag, row.Action);
        Assert.Equal(26.8, row.DifferencePct);
    }

    [Fact]
    public void Merge_DifferentUnit_IsFlagged()
    {
        var row = Assert.Single(BoqMerge.Preview(Generated, [Scanned(1, 44m, unit: "box")]));
        Assert.Equal(MergeActions.Flag, row.Action);
    }

    [Fact]
    public void Merge_RowNotInTheGeneratedBoq_IsAdded()
    {
        var rows = BoqMerge.Preview(Generated, [Scanned(99, 10m), Scanned(1, 63m, sub: "Partition")]);
        Assert.All(rows, r => Assert.Equal(MergeActions.Add, r.Action));
    }

    [Theory]
    [InlineData(0, "sq.m")]
    [InlineData(10, "")]
    [InlineData(10, "gibberish")]
    public void Merge_IncompleteRows_AreNeverAddedSilently(decimal qty, string unit)
    {
        var row = Assert.Single(BoqMerge.Preview(Generated, [Scanned(null, qty, unit)]));
        Assert.Equal(MergeActions.Incomplete, row.Action);
    }

    // ── Measurement area override ────────────────────────────────────────────

    [Fact]
    public async Task ExtractedRoom_KeepsItsPolygonArea_UntilTheDimensionsChange()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var phase = await TestDataBuilder.CreatePhaseAsync(db, project.Id);
        var service = new MeasurementService(db);

        MeasurementUpsertDto Floor(int? id, decimal length, decimal? area) => new()
        {
            Id = id, PhaseId = phase.Id, ElementType = "Floor", AreaLabel = "GF · Sales Area",
            LengthM = length, WidthM = 6.1m, ThicknessM = 0, AreaSqm = area, PerimeterM = area is null ? null : 33.2m,
        };

        var saved = Assert.Single(await service.BulkSaveAsync(project.Id, [Floor(null, 11.78m, 63.1m)], admin.Id));
        Assert.Equal(63.1m, saved.AreaSqm);                 // not 11.78 × 6.1
        Assert.Equal(33.2m, saved.PerimeterM);

        var resaved = Assert.Single(await service.BulkSaveAsync(project.Id, [Floor(saved.Id, 11.78m, null)], admin.Id));
        Assert.Equal(63.1m, resaved.AreaSqm);               // a screen that doesn't send the area back

        var edited = Assert.Single(await service.BulkSaveAsync(project.Id, [Floor(saved.Id, 10m, null)], admin.Id));
        Assert.Equal(61m, edited.AreaSqm);                  // dimensions changed by hand → L × W
        Assert.Null(edited.PerimeterM);
    }

    [Fact]
    public async Task AreaOverride_IsIgnoredForStructuralElements()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);
        var project = await TestDataBuilder.CreateProjectAsync(db, admin.Id);
        var phase = await TestDataBuilder.CreatePhaseAsync(db, project.Id);

        var saved = Assert.Single(await new MeasurementService(db).BulkSaveAsync(project.Id,
            [new MeasurementUpsertDto { PhaseId = phase.Id, ElementType = "Slab", LengthM = 4, WidthM = 5, ThicknessM = 0.1m, AreaSqm = 99 }], admin.Id));
        Assert.Equal(20m, saved.AreaSqm);
    }

    // ── Material properties API ──────────────────────────────────────────────

    [Fact]
    public async Task UpdateProperties_RequiresTheFieldsTheTypeNeeds()
    {
        await using var db = fixture.CreateContext();
        var material = await TestDataBuilder.CreateMaterialAsync(db, unit: "pc");
        var controller = new MaterialsController(db);

        Assert.IsType<BadRequestObjectResult>(await controller.UpdateProperties(material.Id,
            new MaterialPropertiesDto { CalculationType = "UnitArea", LengthMm = 400 }));
        Assert.IsType<BadRequestObjectResult>(await controller.UpdateProperties(material.Id,
            new MaterialPropertiesDto { CalculationType = "Bogus" }));

        var ok = Assert.IsType<OkObjectResult>(await controller.UpdateProperties(material.Id,
            new MaterialPropertiesDto { CalculationType = "unitarea", LengthMm = 400, WidthMm = 200, PropertiesSource = " TDS 2025 " }));
        var dto = Assert.IsType<MaterialResponseDto>(ok.Value);
        Assert.Equal("UnitArea", dto.Properties.CalculationType);
        Assert.Equal("TDS 2025", dto.Properties.PropertiesSource);
    }

    [Fact]
    public async Task ApplyDefaults_FillsOnlyMaterialsWithoutProperties()
    {
        await using var db = fixture.CreateContext();
        var category = new MaterialCategory { Name = "Cat " + Guid.NewGuid().ToString("N")[..8] };
        db.MaterialCategories.Add(category);
        var fresh = new Material { Name = $"Tile Adhesive {Guid.NewGuid():N}", Unit = "bag", Category = category };
        var curated = new Material { Name = $"Tile Grout {Guid.NewGuid():N}", Unit = "bag", Category = category,
            CalculationType = MaterialCalculationType.CoverageRate, CoveragePerUnit = 7, PropertiesSource = "Admin" };
        db.Materials.AddRange(fresh, curated);
        await db.SaveChangesAsync();

        await new MaterialsController(db).ApplyDefaults();

        await using var verify = fixture.CreateContext();
        Assert.Equal(4m, (await verify.Materials.SingleAsync(m => m.Id == fresh.Id)).CoveragePerUnit);
        var untouched = await verify.Materials.SingleAsync(m => m.Id == curated.Id);
        Assert.Equal(7m, untouched.CoveragePerUnit);
        Assert.Equal("Admin", untouched.PropertiesSource);
    }

    // ── Baseline + alerts on BOQ rows ────────────────────────────────────────

    [Fact]
    public void Alerts_FarFromExpectedAndUnitMismatch()
    {
        var board = BaselineCalculator.Compute(new BaselineMaterial("sq.m", MaterialCalculationType.UnitArea,
            LengthMm: 2400, WidthMm: 1200, PurchaseUnit: "sheet"), "sq.m", 708.5m);

        Assert.Empty(BaselineCalculator.Alerts(board, 260m, "sht"));                       // +5.7%, same unit
        Assert.Equal([BaselineCalculator.AlertFarFromExpected], BaselineCalculator.Alerts(board, 320m, "sheet"));
        Assert.Equal([BaselineCalculator.AlertUnitMismatch], BaselineCalculator.Alerts(board, 30m, "pcs"));
        Assert.Equal([BaselineCalculator.AlertMissingProps],
            BaselineCalculator.Alerts(BaselineCalculator.Compute(new BaselineMaterial("sq.m", null), "sq.m", 10m), 5m, "pc"));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static async Task<ProjectDocument> CreateDocumentAsync(ConstructIQ.API.Data.AppDbContext db, int projectId, int userId, DocumentCategory category)
    {
        var doc = new ProjectDocument
        {
            ProjectId = projectId, Category = category, FileName = "plan.pdf",
            StoragePath = "/uploads/documents/test/plan.pdf", SizeBytes = 1, UploadedByUserId = userId,
        };
        db.ProjectDocuments.Add(doc);
        await db.SaveChangesAsync();
        return doc;
    }

    private static ControllerContext ContextFor(User user) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
            ], "Test")),
        },
    };
}
