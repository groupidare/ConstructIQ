using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

public enum PhaseStatus { Pending, Active, Completed }

public class Phase
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    [Required, MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    public int Order { get; set; }

    public DateTime StartDate { get; set; }
    public DateTime EndDate   { get; set; }

    public PhaseStatus Status          { get; set; } = PhaseStatus.Pending;
    public decimal     ProgressPercent { get; set; } = 0;

    public ICollection<BOQItem>           BOQItems           { get; set; } = [];
    public ICollection<MaterialMovement>  MaterialMovements  { get; set; } = [];
    public ICollection<ExcessWasteRecord> ExcessWasteRecords { get; set; } = [];
    public ICollection<Measurement>       Measurements       { get; set; } = [];
}
