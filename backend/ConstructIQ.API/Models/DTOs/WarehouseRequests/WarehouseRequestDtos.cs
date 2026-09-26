using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.WarehouseRequests;

public class WarehouseRequestCreateDto
{
    [Required] public int ProjectId { get; set; }
    [Required] public int MaterialId { get; set; }
    [Range(0.0001, double.MaxValue)] public decimal RequestedQuantity { get; set; }
}

public class WarehouseRequestApproveDto
{
    // Defaults to the full RequestedQuantity when omitted, but should be
    // sent explicitly whenever the warehouse can't release the full amount.
    [Range(0.0001, double.MaxValue)] public decimal ApprovedQuantity { get; set; }
}

public class WarehouseRequestResponseDto
{
    public int      Id                { get; set; }
    public int      ProjectId         { get; set; }
    public string   ProjectName       { get; set; } = string.Empty;
    public int      MaterialId        { get; set; }
    public string   MaterialName      { get; set; } = string.Empty;
    public string   Unit              { get; set; } = string.Empty;
    public decimal  RequestedQuantity { get; set; }
    public decimal? ApprovedQuantity  { get; set; }
    public string   Status            { get; set; } = string.Empty;
    public string   RequestedBy       { get; set; } = string.Empty;
    public DateTime RequestedAt       { get; set; }
    public string?  ApprovedBy        { get; set; }
    public DateTime? ApprovedAt       { get; set; }
}
