using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ConstructIQ.API.Models.Entities;

public enum ProjectStatus { Planning, Active, OnHold, Completed, Cancelled }
public enum ProjectType  { Residential, Commercial, Industrial, Infrastructure, Renovation }

public class Project
{
    public int Id { get; set; }

    [Required, MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    public ProjectType Type { get; set; }

    [Required, MaxLength(300)]
    public string Location { get; set; } = string.Empty;

    public string? Description { get; set; }

    [Column(TypeName = "decimal(18,2)")]
    public decimal Budget { get; set; }

    public DateTime StartDate     { get; set; }
    public DateTime TargetEndDate { get; set; }
    public ProjectStatus Status   { get; set; } = ProjectStatus.Planning;

    [MaxLength(200)]
    public string? AssignedContractor { get; set; }

    public int ProjectManagerId { get; set; }
    public User ProjectManager { get; set; } = null!;

    public int? SiteEngineerId { get; set; }
    public User? SiteEngineer { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Phase>               Phases                  { get; set; } = [];
    public ICollection<BOQItem>             BOQItems                { get; set; } = [];
    public ICollection<InventoryRecord>     InventoryRecords        { get; set; } = [];
    public ICollection<ExcessWasteRecord>   ExcessWasteRecords      { get; set; } = [];
    public ICollection<ForecastResult>      ForecastResults         { get; set; } = [];
    public ICollection<ProcurementRecommendation> ProcurementRecommendations { get; set; } = [];
}
