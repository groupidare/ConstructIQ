using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.DTOs.Procurement;

public class ProcurementRecommendationDto
{
    public int      Id                    { get; set; }
    public int      ProjectId             { get; set; }
    public int      MaterialId            { get; set; }
    public string   MaterialName          { get; set; } = string.Empty;
    public string   Unit                  { get; set; } = string.Empty;
    public decimal  CurrentStock          { get; set; }
    public decimal  ReorderPoint          { get; set; }
    public decimal  TargetStockLevel      { get; set; }
    public decimal  ForecastedDemand      { get; set; }
    public decimal  RecommendedQuantity   { get; set; }
    public decimal  EstimatedCost         { get; set; }
    public DateTime SuggestedReorderDate  { get; set; }
    public int      EstimatedLeadTimeDays { get; set; }
    public string   UrgencyLevel          { get; set; } = string.Empty;
    public string?  Notes                 { get; set; }
    public DateTime GeneratedAt           { get; set; }
}

public class PurchaseRequestCreateDto
{
    [Required] public int     ProjectId           { get; set; }
    public int?    RecommendationId   { get; set; }
    [Required] public int     MaterialId           { get; set; }
    [Range(0.0001, double.MaxValue)] public decimal RequestedQuantity { get; set; }
    [Range(0, double.MaxValue)]      public decimal EstimatedUnitCost { get; set; }
    public string? Notes { get; set; }
}

public class PurchaseRequestDto
{
    public int      Id                  { get; set; }
    public int      ProjectId           { get; set; }
    public string   ProjectName         { get; set; } = string.Empty;
    public int?     RecommendationId    { get; set; }
    public int      MaterialId          { get; set; }
    public string   MaterialName        { get; set; } = string.Empty;
    public string   Unit                { get; set; } = string.Empty;
    public decimal  RequestedQuantity   { get; set; }
    public decimal  EstimatedUnitCost   { get; set; }
    public decimal  TotalEstimatedCost  { get; set; }
    public string   Status              { get; set; } = string.Empty;
    public string   RequestedBy         { get; set; } = string.Empty;
    public DateTime RequestedAt         { get; set; }
    public string?  ApprovedBy          { get; set; }
    public DateTime? ApprovedAt         { get; set; }
    public string?  Notes               { get; set; }
}

public class RedistributionRecommendationDto
{
    public int      Id                  { get; set; }
    public int      SourceMaterialId    { get; set; }
    public string   MaterialName        { get; set; } = string.Empty;
    public string   Unit                { get; set; } = string.Empty;
    public int      SourceProjectId     { get; set; }
    public string   SourceProjectName   { get; set; } = string.Empty;
    public int      TargetProjectId     { get; set; }
    public string   TargetProjectName   { get; set; } = string.Empty;
    public decimal  AvailableQuantity   { get; set; }
    public decimal  NeededQuantity      { get; set; }
    public decimal  TransferQuantity    { get; set; }
    public decimal  EstimatedSavings    { get; set; }
    public string   Status              { get; set; } = string.Empty;
    public DateTime GeneratedAt         { get; set; }
}
