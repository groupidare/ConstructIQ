using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Notification;

public class NotificationCreateDto
{
    [Required] public int    ProjectId     { get; set; }
    public int?    MaterialId    { get; set; }
    [Required] public string RecipientRole { get; set; } = string.Empty; // ProcurementOfficer | WarehousePersonnel
    [Required] public string Kind          { get; set; } = string.Empty; // ProcurementOrder | WarehouseCheck
    [Required] public string Message       { get; set; } = string.Empty;
    public decimal? Quantity     { get; set; }
}

public class NotificationResponseDto
{
    public int      Id            { get; set; }
    public string   RecipientRole { get; set; } = string.Empty;
    public int      ProjectId     { get; set; }
    public string   ProjectName   { get; set; } = string.Empty;
    public int?     MaterialId    { get; set; }
    public string?  MaterialName  { get; set; }
    public string   Kind          { get; set; } = string.Empty;
    public string   Message       { get; set; } = string.Empty;
    public decimal? Quantity      { get; set; }
    public bool     IsRead        { get; set; }
    public DateTime CreatedAt     { get; set; }
}
