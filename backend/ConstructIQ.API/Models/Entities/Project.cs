using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum ProjectStatus { Planning, Active, OnHold, Completed, Cancelled }
public enum ProjectType  { Residential, Commercial, Industrial, Infrastructure, Renovation, Others }

public class Project
{
    public int Id { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    public ProjectType Type { get; set; }

    // Only meaningful when Type == Others.
    [MaxLength(200)]
    public string? OtherTypeSpecify { get; set; }

    [Required, MaxLength(300)]
    public string Location { get; set; } = string.Empty;

    public string? Description { get; set; }

    [Column(TypeName = "decimal(18,2)")]
    public decimal Budget { get; set; }

    public DateTime StartDate     { get; set; }
    public DateTime TargetEndDate { get; set; }
    public ProjectStatus Status   { get; set; } = ProjectStatus.Planning;

    // Overall completion, 0-100, set via the Progress Tracker (see
    // ProjectProgressUpdate for the log of individual updates behind it).
    // Driving two auto-transitions in ProjectService.LogProgressAsync:
    // Planning -> Active once it passes 10%, and -> Completed + IsHistorical
    // once it reaches 100% (see IsHistorical below).
    public int Progress { get; set; }

    // True for projects backfilled via "Add Completed Project" (pure
    // historical records entered to train the forecasting model) AND for
    // real projects that reached 100% progress organically through the app —
    // both are finished projects whose BOQ/PO data should feed the
    // forecasting model as training data. The project's own real BOQItems,
    // PurchaseOrders, and Documents are never touched by this flag; it only
    // changes how the UI presents the project (read-only, grouped under
    // Historical Data) and that it's now eligible as forecast training data.
    public bool IsHistorical { get; set; }

    [MaxLength(200)]
    public string? AssignedContractor { get; set; }

    public int ProjectManagerId { get; set; }
    public User ProjectManager { get; set; } = null!;

    public int? SiteEngineerId { get; set; }
    public User? SiteEngineer { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Phase>               Phases                  { get; set; } = [];
    public ICollection<ProjectProgressUpdate> ProgressUpdates        { get; set; } = [];
    public ICollection<BOQItem>             BOQItems                { get; set; } = [];
    public ICollection<InventoryRecord>     InventoryRecords        { get; set; } = [];
    public ICollection<ExcessWasteRecord>   ExcessWasteRecords      { get; set; } = [];
    public ICollection<ForecastResult>      ForecastResults         { get; set; } = [];
    public ICollection<ProcurementRecommendation> ProcurementRecommendations { get; set; } = [];
}
