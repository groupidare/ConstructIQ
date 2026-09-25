using System.ComponentModel.DataAnnotations;

namespace ConstructIQ.API.Models.Entities;

// One logged entry from the Progress Tracker — a snapshot of overall
// progress at the time it was reported, plus the site notes/photos behind
// it. Project.Progress always holds the latest value; this table is the
// history feeding "Recent Updates".
public class ProjectProgressUpdate
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int Progress { get; set; }

    [Required]
    public string Notes { get; set; } = string.Empty;

    public int UpdatedByUserId { get; set; }
    public User UpdatedBy { get; set; } = null!;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ProjectProgressPhoto> Photos { get; set; } = [];
}

public class ProjectProgressPhoto
{
    public int Id { get; set; }

    public int ProjectProgressUpdateId { get; set; }
    public ProjectProgressUpdate ProjectProgressUpdate { get; set; } = null!;

    [Required, MaxLength(255)]
    public string Url { get; set; } = string.Empty;
}
