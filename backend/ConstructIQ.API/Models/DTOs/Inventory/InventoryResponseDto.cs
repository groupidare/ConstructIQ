namespace ConstructIQ.API.Models.DTOs.Inventory;

public class InventoryResponseDto
{
    public int     Id                { get; set; }
    public int     ProjectId         { get; set; }
    public int     MaterialId        { get; set; }
    public string  MaterialName      { get; set; } = string.Empty;
    public string  Specification     { get; set; } = string.Empty;
    public string  Unit              { get; set; } = string.Empty;
    public decimal AvailableQuantity { get; set; }
    public decimal UsedQuantity      { get; set; }
    public decimal WastedQuantity    { get; set; }
    public decimal ExcessQuantity    { get; set; }
    public decimal ReorderPoint      { get; set; }
    public decimal TargetStockLevel  { get; set; }
    public string  StockStatus       { get; set; } = string.Empty;
    public DateTime LastUpdated      { get; set; }
}
