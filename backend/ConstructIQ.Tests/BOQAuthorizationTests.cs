using ConstructIQ.API.Models.Entities;
using ConstructIQ.API.Services;
using Xunit;

namespace ConstructIQ.Tests;

[Collection("Database")]
public class BOQAuthorizationTests(DatabaseFixture fixture)
{
    // Case 18: a Site Engineer must only see reconciled data for projects
    // they're actually assigned to — not every project in the system, which
    // is what GET /boq/monthly-demand-summary did before this rework.
    [Fact]
    public async Task SiteEngineer_OnlySeesTheirOwnAssignedProjects()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db, UserRole.Admin);
        var siteEngineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var otherSiteEngineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var material = await TestDataBuilder.CreateMaterialAsync(db);

        var ownProject = await TestDataBuilder.CreateProjectAsync(db, admin.Id, siteEngineerId: siteEngineer.Id);
        var ownBoq = await TestDataBuilder.CreateBoqItemAsync(db, ownProject.Id, material.Id, admin.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, ownProject.Id, material.Id, ownBoq.Id, admin.Id, 10, isReusable: true);

        var otherProject = await TestDataBuilder.CreateProjectAsync(db, admin.Id, siteEngineerId: otherSiteEngineer.Id);
        var otherBoq = await TestDataBuilder.CreateBoqItemAsync(db, otherProject.Id, material.Id, admin.Id, estimatedQuantity: 200);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, otherProject.Id, material.Id, otherBoq.Id, admin.Id, 20, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(siteEngineer.Id, "SiteEngineer", material.Id, null)).ToList();

        Assert.Single(summary);
        Assert.Equal(90, summary[0].ActualUsage); // only the 100-10 project, never the other engineer's 200-20
        Assert.DoesNotContain(otherProject.Name, summary[0].ContributingProjects);
    }

    [Fact]
    public async Task Admin_SeesAllProjects()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db, UserRole.Admin);
        var siteEngineer = await TestDataBuilder.CreateUserAsync(db, UserRole.SiteEngineer);
        var material = await TestDataBuilder.CreateMaterialAsync(db);

        var projectA = await TestDataBuilder.CreateProjectAsync(db, admin.Id, siteEngineerId: siteEngineer.Id);
        var boqA = await TestDataBuilder.CreateBoqItemAsync(db, projectA.Id, material.Id, admin.Id, estimatedQuantity: 100);
        await TestDataBuilder.CreateExcessWasteRecordAsync(db, projectA.Id, material.Id, boqA.Id, admin.Id, 10, isReusable: true);

        var boqService = new BOQService(db);
        var summary = (await boqService.GetMonthlyDemandSummaryAsync(admin.Id, "Admin", material.Id, null)).ToList();
        Assert.Single(summary);
        Assert.Equal(90, summary[0].ActualUsage);
    }
}
