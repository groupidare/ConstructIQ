using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.BOQ;

public class BOQItemUpsertDto
{
    public int?    Id                { get; set; } // null = create new
    public int?    PhaseId           { get; set; }
    [Required] public string PrimarySection { get; set; } = string.Empty;
    public string? SubCategory       { get; set; }
    // Either MaterialId (existing catalog entry) or NewMaterialName (+ Unit) —
    // exactly one path is required; see BOQService.
    public int?    MaterialId        { get; set; }
    public string? NewMaterialName   { get; set; }
    public string? Unit              { get; set; }
    public decimal EstimatedQuantity { get; set; }
    // Only meaningful for historical/completed projects backfilling training
    // data — live projects derive actual usage from inventory movements instead.
    public decimal? ActualQuantity   { get; set; }
    public string? Notes             { get; set; }
}

public class BOQBulkSaveDto
{
    [Required] public int ProjectId { get; set; }
    public List<BOQItemUpsertDto> Items { get; set; } = [];
}

public class BOQItemResponseDto
{
    public int      Id                { get; set; }
    public int      ProjectId         { get; set; }
    public int?     PhaseId           { get; set; }
    public string?  PhaseName         { get; set; }
    public string   PrimarySection    { get; set; } = string.Empty;
    public string?  SubCategory       { get; set; }
    public int      MaterialId        { get; set; }
    public string   MaterialName      { get; set; } = string.Empty;
    public string   Unit              { get; set; } = string.Empty;
    public decimal  EstimatedQuantity { get; set; }
    public decimal  ActualQuantity    { get; set; }
    public string?  Notes             { get; set; }
    public DateTime CreatedAt         { get; set; }
}
