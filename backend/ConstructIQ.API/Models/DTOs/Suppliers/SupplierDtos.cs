namespace ConstructIQ.API.Models.DTOs.Suppliers;

public record SupplierDto
{
    public int      Id           { get; init; }
    public string   Name         { get; init; } = "";
    public string   Category     { get; init; } = "";
    public string   Lead         { get; init; } = "";
    public string?  ContactEmail { get; init; }
    public string?  ContactPhone { get; init; }

    // Always computed live from evaluation history — never stored, so these
    // can't drift from what's actually been logged.
    public double Rating   { get; init; }
    public int    OnTimePct { get; init; }
    public int    Deliveries { get; init; }
}

public record DeliveryEvaluationDto
{
    public int    PriceRating          { get; init; }
    public int    DeliveryRating       { get; init; }
    public int    QualityRating        { get; init; }
    public int    AccuracyRating       { get; init; }
    public int    ResponsivenessRating { get; init; }
    public bool   OnTime               { get; init; }
    public int    ActualLeadDays       { get; init; }
    public string? Comments            { get; init; }
    public string RaterName            { get; init; } = "";
    public List<string> PhotoUrls      { get; init; } = [];
}

public record SupplierHistoryEntryDto
{
    public string   PoNumber     { get; init; } = "";
    public string   ProjectName  { get; init; } = "";
    public string   Status       { get; init; } = "";
    public DateTime ExpectedDate { get; init; }
    public DeliveryEvaluationDto? Evaluation { get; init; }
}

public record SupplierDetailDto : SupplierDto
{
    public List<SupplierHistoryEntryDto> History { get; init; } = [];
}

public record UpdateSupplierContactDto(string? Email, string? Phone);
