namespace ConstructIQ.API.Models.Entities;

// A blueprint read the user added to the Material Plan — the floors read,
// their pages and room outlines (PDF points), as JSON the frontend owns. Each
// generated BOQ row's BlueprintSource names it, so the row can be shown on
// the plan (its rooms highlighted, the note it came from) long after the
// wizard is closed. No page images: pages are rendered from the stored PDF.
public class BlueprintRead
{
    public int Id { get; set; }

    public int ProjectId { get; set; }
    public Project Project { get; set; } = null!;

    public int DocumentId { get; set; }
    public ProjectDocument Document { get; set; } = null!;

    public string ReadJson { get; set; } = string.Empty;

    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
