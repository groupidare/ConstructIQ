using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Project;

public class ProjectCreateDto
{
    [Required, MaxLength(200)] public string Name     { get; set; } = string.Empty;
    [Required]                 public string Type     { get; set; } = string.Empty;
    [Required, MaxLength(300)] public string Location { get; set; } = string.Empty;
    public string? Description       { get; set; }
    [Range(0, double.MaxValue)] public decimal Budget { get; set; }
    [Required] public DateTime StartDate      { get; set; }
    [Required] public DateTime TargetEndDate  { get; set; }
    public string? AssignedContractor { get; set; }
    public int?    SiteEngineerId     { get; set; }
    public List<PhaseCreateDto> Phases { get; set; } = [];
}

public class PhaseCreateDto
{
    [Required, MaxLength(150)] public string Name { get; set; } = string.Empty;
    public int      Order     { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime EndDate   { get; set; }
}
