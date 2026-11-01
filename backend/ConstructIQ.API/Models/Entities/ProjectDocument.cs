using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

public enum DocumentCategory { Blueprint, BOQ, PurchaseOrder, Contract, Other }

public class ProjectDocument
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public DocumentCategory Category { get; set; }

    // Only meaningful when Category is Other — the user's own label for it
    // (mirrors the Project.OtherTypeSpecify "specify" pattern used elsewhere).
    [MaxLength(200)]
    public string? CategoryOther { get; set; }

    [MaxLength(1000)]
    public string? Description { get; set; }

    [Required, MaxLength(255)]
    public string FileName { get; set; } = string.Empty;

    // Relative path under wwwroot/uploads — never a client-supplied path.
    [Required, MaxLength(500)]
    public string StoragePath { get; set; } = string.Empty;

    public long SizeBytes { get; set; }

    public int UploadedByUserId { get; set; }
    public User UploadedBy { get; set; } = null!;

    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}
