using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Inventory;

public class MovementCreateDto
{
    [Required] public int    ProjectId    { get; set; }
    [Required] public int    MaterialId   { get; set; }
    [Required] public string MovementType { get; set; } = string.Empty;
    [Range(0.0001, double.MaxValue)] public decimal Quantity { get; set; }
    public int?    PhaseId { get; set; }
    public string? Notes   { get; set; }
}
