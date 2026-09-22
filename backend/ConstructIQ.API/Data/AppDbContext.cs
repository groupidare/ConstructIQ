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
    public DbSet<Measurement>              Measurements              => Set<Measurement>();
    public DbSet<ProjectDocument>          ProjectDocuments          => Set<ProjectDocument>();
    public DbSet<Notification>             Notifications             => Set<Notification>();
    public DbSet<Supplier>                 Suppliers                 => Set<Supplier>();
    public DbSet<PurchaseOrder>            PurchaseOrders            => Set<PurchaseOrder>();
    public DbSet<PurchaseOrderMaterial>    PurchaseOrderMaterials    => Set<PurchaseOrderMaterial>();
    public DbSet<DeliveryEvaluation>       DeliveryEvaluations       => Set<DeliveryEvaluation>();
    public DbSet<DeliveryPhoto>            DeliveryPhotos            => Set<DeliveryPhoto>();
    public DbSet<WarehouseStockItem>       WarehouseStockItems       => Set<WarehouseStockItem>();

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

        // Cascade (not Restrict): a redistribution request between two projects
        // has no meaning once either project is gone — deleting a project should
        // be able to succeed outright, not be blocked by requests referencing it.
        mb.Entity<RedistributionRequest>()
            .HasOne(r => r.SourceProject)
            .WithMany()
            .HasForeignKey(r => r.SourceProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        mb.Entity<RedistributionRequest>()
            .HasOne(r => r.TargetProject)
            .WithMany()
            .HasForeignKey(r => r.TargetProjectId)
            .OnDelete(DeleteBehavior.Cascade);

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

        mb.Entity<Measurement>()
            .HasOne(m => m.RecordedBy)
            .WithMany()
            .HasForeignKey(m => m.RecordedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<ProjectDocument>()
            .HasOne(d => d.UploadedBy)
            .WithMany()
            .HasForeignKey(d => d.UploadedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<Notification>()
            .HasOne(n => n.CreatedBy)
            .WithMany()
            .HasForeignKey(n => n.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<PurchaseOrder>()
            .HasIndex(po => po.Number)
            .IsUnique();

        // Cascade: a PurchaseOrder (and its Materials/Evaluation/Photos, already
        // Cascade below/by convention) is project-owned data — deleting the
        // project should be able to succeed, not be blocked by its own POs.
        mb.Entity<PurchaseOrder>()
            .HasOne(po => po.Project)
            .WithMany()
            .HasForeignKey(po => po.ProjectId)
            .OnDelete(DeleteBehavior.Cascade);

        mb.Entity<PurchaseOrder>()
            .HasOne(po => po.Supplier)
            .WithMany(s => s.PurchaseOrders)
            .HasForeignKey(po => po.SupplierId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<PurchaseOrder>()
            .HasOne(po => po.CreatedBy)
            .WithMany()
            .HasForeignKey(po => po.CreatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<PurchaseOrder>()
            .HasOne(po => po.Evaluation)
            .WithOne(e => e.PurchaseOrder)
            .HasForeignKey<DeliveryEvaluation>(e => e.PurchaseOrderId)
            .OnDelete(DeleteBehavior.Cascade);

        mb.Entity<DeliveryEvaluation>()
            .HasOne(e => e.RatedBy)
            .WithMany()
            .HasForeignKey(e => e.RatedByUserId)
            .OnDelete(DeleteBehavior.Restrict);

        mb.Entity<Supplier>()
            .HasIndex(s => s.Name)
            .IsUnique();

        mb.Entity<PurchaseOrderMaterial>()
            .HasOne(m => m.Material)
            .WithMany()
            .HasForeignKey(m => m.MaterialId)
            .OnDelete(DeleteBehavior.SetNull);

        mb.Entity<PurchaseOrderMaterial>()
            .HasOne(m => m.BOQItem)
            .WithMany()
            .HasForeignKey(m => m.BOQItemId)
            .OnDelete(DeleteBehavior.SetNull);

        mb.Entity<PurchaseOrderMaterial>()
            .HasOne(m => m.Phase)
            .WithMany()
            .HasForeignKey(m => m.PhaseId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
