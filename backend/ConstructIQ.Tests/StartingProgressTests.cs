using ConstructIQ.API.Models.DTOs.Project;
using ConstructIQ.API.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace ConstructIQ.Tests;

// An ongoing project entered mid-way starts at its real progress, logged as
// its first Progress Tracker entry.
[Collection("Database")]
public class StartingProgressTests(DatabaseFixture fixture)
{
    private sealed class NoGeocoding : IWeatherGeocodingService
    {
        public Task<(decimal Latitude, decimal Longitude)?> GeocodeAsync(string location, CancellationToken ct = default) =>
            Task.FromResult<(decimal, decimal)?>(null);
    }

    private static ProjectCreateDto Dto(int? startingProgress, string? status = null, bool isHistorical = false) => new()
    {
        Name = "Project " + Guid.NewGuid().ToString("N")[..8],
        Type = "Commercial",
        Location = "BGC",
        StartDate = new DateTime(2026, 1, 5),
        TargetEndDate = new DateTime(2027, 1, 5),
        Status = status,
        IsHistorical = isHistorical,
        StartingProgress = startingProgress,
    };

    [Fact]
    public async Task OngoingProject_StartsAtItsProgress_WithAFirstProgressEntry()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);

        var created = await new ProjectService(db, null!, new NoGeocoding()).CreateAsync(Dto(35, "Active"), admin.Id, "Admin");

        Assert.Equal(35, created.Progress);
        Assert.Equal("Active", created.Status);
        var update = await db.ProjectProgressUpdates.SingleAsync(u => u.ProjectId == created.Id);
        Assert.Equal(35, update.Progress);
        Assert.Equal(admin.Id, update.UpdatedByUserId);
    }

    [Fact]
    public async Task PlanningProject_PastTheActiveThreshold_BecomesActive()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);

        var created = await new ProjectService(db, null!, new NoGeocoding()).CreateAsync(Dto(40), admin.Id, "Admin");

        Assert.Equal("Active", created.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    public async Task NoStartingProgress_StartsAtZero_WithNoEntry(int? startingProgress)
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);

        var created = await new ProjectService(db, null!, new NoGeocoding()).CreateAsync(Dto(startingProgress), admin.Id, "Admin");

        Assert.Equal(0, created.Progress);
        Assert.Equal("Planning", created.Status);
        Assert.False(await db.ProjectProgressUpdates.AnyAsync(u => u.ProjectId == created.Id));
    }

    [Fact]
    public async Task HistoricalProject_IgnoresStartingProgress()
    {
        await using var db = fixture.CreateContext();
        var admin = await TestDataBuilder.CreateUserAsync(db);

        var created = await new ProjectService(db, null!, new NoGeocoding()).CreateAsync(Dto(35, "Completed", isHistorical: true), admin.Id, "Admin");

        Assert.Equal(100, created.Progress);
        Assert.False(await db.ProjectProgressUpdates.AnyAsync(u => u.ProjectId == created.Id));
    }
}
