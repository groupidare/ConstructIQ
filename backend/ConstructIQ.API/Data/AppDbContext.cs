using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User>                     Users                     => Set<User>();
    public DbSet<Project>                  Projects                  => Set<Project>();
    public DbSet<Phase>                    Phases                    => Set<Phase>();
    public DbSet<MaterialCategory>         MaterialCategories        => Set<MaterialCategory>();
    public DbSet<Material>                 Materials                 => Set<Material>();
    public DbSet<BOQItem>                  BOQItems                  => Set<BOQItem>();
    public DbSet<InventoryRecord>          InventoryRecords          => Set<InventoryRecord>();
    public DbSet<MaterialMovement>         MaterialMovements         => Set<MaterialMovement>();
    public DbSet<ExcessWasteRecord>        ExcessWasteRecords        => Set<ExcessWasteRecord>();
    public DbSet<ForecastResult>           ForecastResults           => Set<ForecastResult>();
    public DbSet<ForecastedMaterial>       ForecastedMaterials       => Set<ForecastedMaterial>();
    public DbSet<ProcurementRecommendation> ProcurementRecommendations => Set<ProcurementRecommendation>();
    public DbSet<PurchaseRequest>          PurchaseRequests          => Set<PurchaseRequest>();
    public DbSet<RedistributionRequest>    RedistributionRequests    => Set<RedistributionRequest>();
    public DbSet<ActivityLog>              ActivityLogs              => Set<ActivityLog>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        base.OnModelCreating(mb);

        mb.Entity<User>().HasIndex(u => u.Username).IsUnique();
        mb.Entity<User>().HasIndex(u => u.Email).IsUnique();

        mb.Entity<InventoryRecord>()
            .HasIndex(i => new { i.ProjectId, i.MaterialId })
            .IsUnique();

        mb.Entity<Project>()
            .HasOne(p => p.ProjectManager)
            .WithMany(u => u.ManagedProjects)
            .HasForeignKey(p => p.ProjectManagerId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<Project>()
            .HasOne(p => p.SiteEngineer)
            .WithMany()
            .HasForeignKey(p => p.SiteEngineerId)
            .OnDelete(DeleteBehavior.SetNull);

        mb.Entity<MaterialMovement>()
            .HasOne(m => m.RecordedBy)
            .WithMany()
            .HasForeignKey(m => m.RecordedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<ExcessWasteRecord>()
            .HasOne(e => e.RecordedBy)
            .WithMany()
            .HasForeignKey(e => e.RecordedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<ActivityLog>()
            .HasOne(a => a.User)
            .WithMany(u => u.ActivityLogs)
            .HasForeignKey(a => a.UserId)
            .OnDelete(DeleteBehavior.SetNull);

        mb.Entity<RedistributionRequest>()
            .HasOne(r => r.SourceProject)
            .WithMany()
            .HasForeignKey(r => r.SourceProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<RedistributionRequest>()
            .HasOne(r => r.TargetProject)
            .WithMany()
            .HasForeignKey(r => r.TargetProjectId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<RedistributionRequest>()
            .HasOne(r => r.RequestedBy)
            .WithMany()
            .HasForeignKey(r => r.RequestedByUserId)
            .OnDelete(DeleteBehavior.SetNull);

        mb.Entity<RedistributionRequest>()
            .HasOne(r => r.ApprovedBy)
            .WithMany()
            .HasForeignKey(r => r.ApprovedByUserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
