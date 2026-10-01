using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Phase;

public class AddPhaseDto
{
    [Required] public int ProjectId { get; set; }
    [Required, MaxLength(150)] public string Name { get; set; } = string.Empty;
    public int? Order { get; set; } // null = append at the end
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
}
