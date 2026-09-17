namespace ConstructIQ.API.Models.DTOs.Project;

public class ProjectResponseDto
{
    public int     Id                  { get; set; }
    public string  Name                { get; set; } = string.Empty;
    public string  Type                { get; set; } = string.Empty;
    public string? OtherTypeSpecify    { get; set; }
    public string  Location            { get; set; } = string.Empty;
    public string? Description         { get; set; }
    public decimal Budget              { get; set; }
    public DateTime StartDate          { get; set; }
    public DateTime TargetEndDate      { get; set; }
    public string  Status              { get; set; } = string.Empty;
    public string? AssignedContractor  { get; set; }
    public int     ProjectManagerId    { get; set; }
    public string  ProjectManagerName  { get; set; } = string.Empty;
    public int?    SiteEngineerId      { get; set; }
    public string? SiteEngineerName    { get; set; }
    public List<PhaseResponseDto> Phases { get; set; } = [];
    public DateTime CreatedAt          { get; set; }
    public DateTime UpdatedAt          { get; set; }
}

public class PhaseResponseDto
{
    public int     Id              { get; set; }
    public int     ProjectId       { get; set; }
    public string  Name            { get; set; } = string.Empty;
    public int     Order           { get; set; }
    public DateTime StartDate      { get; set; }
    public DateTime EndDate        { get; set; }
    public string  Status          { get; set; } = string.Empty;
    public decimal ProgressPercent { get; set; }
}
