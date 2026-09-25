using System.Security.Claims;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.PurchaseOrders;
using ConstructIQ.API.Models.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/purchase-orders")]
[Authorize]
public class PurchaseOrdersController(AppDbContext db, IWebHostEnvironment env) : ControllerBase
{
    // Roles that manage the PO lifecycle (create + set Pending/Approved).
    // WarehousePersonnel is deliberately excluded — they only receive
    // deliveries, so they can't create POs or move one back to Pending/Approved.
    private const string ManageRoles = "Admin,ProjectManager,ProcurementOfficer";

    // Only warehouse personnel physically receive the delivery, so they're the
    // only ones who can progress one (save a batch, then complete it) or rate
    // the supplier on it — Admin/ProjectManager/ProcurementOfficer manage the
    // lifecycle up through Approved and then watch delivery read-only.
    private const string DeliverRoles = "WarehousePersonnel,Admin";
    private const string RateRoles = "WarehousePersonnel,Admin";

    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int? projectId = null)
    {
        var query = db.PurchaseOrders
            .Include(po => po.Project)
            .Include(po => po.Supplier)
            .Include(po => po.Materials)
            .Include(po => po.Evaluation)
            .Include(po => po.DeliveryBatches).ThenInclude(b => b.Photos)
            .Include(po => po.DeliveryBatches).ThenInclude(b => b.UploadedBy)
            .AsQueryable();

        if (projectId.HasValue)
            query = query.Where(po => po.ProjectId == projectId.Value);

        var orders = await query.OrderByDescending(po => po.CreatedAt).ToListAsync();
        return Ok(orders.Select(ToDto));
    }

    [HttpPost]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> Create([FromBody] CreatePurchaseOrderDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.SupplierName) || dto.Materials.Count == 0)
            return BadRequest(new { message = "Supplier and at least one material are required." });

        var project = await db.Projects.FindAsync(dto.ProjectId);
        if (project is null) return BadRequest(new { message = "Project not found." });

        // Reuse an existing supplier by name (case-insensitive), or auto-create
        // one — this is the only way new suppliers enter the system.
        var supplierName = dto.SupplierName.Trim();
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Name.ToLower() == supplierName.ToLower());
        if (supplier is null)
        {
            supplier = new Supplier { Name = supplierName };
            db.Suppliers.Add(supplier);
        }

        var validMaterials = dto.Materials.Where(m => !string.IsNullOrWhiteSpace(m.Name) && m.Quantity > 0).ToList();
        if (validMaterials.Count == 0)
            return BadRequest(new { message = "At least one valid material is required." });

        // Best-effort exact-name match against the catalog — never auto-created
        // (unlike BOQ scanning), a PO line with no match just stays unlinked
        // until reviewed, so a typo can't silently pollute the Materials table.
        var names = validMaterials.Select(m => m.Name.Trim().ToLower()).Distinct().ToList();
        var materialMatches = await db.Materials
            .Where(m => names.Contains(m.Name.ToLower()))
            .ToDictionaryAsync(m => m.Name.ToLower(), m => m.Id);

        var po = new PurchaseOrder
        {
            Number = $"PO-{DateTime.UtcNow.Year}-{Random.Shared.Next(1000, 9999)}",
            Project = project,
            Supplier = supplier,
            Status = PurchaseOrderStatus.Pending,
            OrderDate = dto.OrderDate ?? DateTime.UtcNow,
            ExpectedDate = dto.ExpectedDate,
            CreatedByUserId = CurrentUserId,
            Materials = validMaterials
                .Select(m => new PurchaseOrderMaterial
                {
                    Name = m.Name.Trim(),
                    Quantity = m.Quantity,
                    Unit = m.Unit,
                    MaterialId = m.MaterialId ?? (materialMatches.TryGetValue(m.Name.Trim().ToLower(), out var id) ? id : null),
                    PhaseId = m.PhaseId,
                    PrimarySection = m.PrimarySection,
                    SubCategory = m.SubCategory,
                })
                .ToList(),
        };

        db.PurchaseOrders.Add(po);
        await db.SaveChangesAsync();

        return Ok(ToDto(po));
    }

    // Explicit link only — never auto-guessed, so a wrong match can't silently
    // corrupt training data. Used by the BOQ/PO reconciliation review UI.
    [HttpPatch("materials/{materialId:int}/link")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> LinkMaterial(int materialId, [FromBody] LinkPurchaseOrderMaterialDto dto)
    {
        var material = await db.PurchaseOrderMaterials.FindAsync(materialId);
        if (material is null) return NotFound();

        if (dto.BOQItemId.HasValue && await db.BOQItems.FindAsync(dto.BOQItemId.Value) is null)
            return BadRequest(new { message = "BOQ item not found." });

        material.BOQItemId = dto.BOQItemId;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> UpdateStatus(int id, [FromBody] UpdatePurchaseOrderStatusDto dto)
    {
        var po = await db.PurchaseOrders
            .Include(p => p.Project).Include(p => p.Supplier).Include(p => p.Materials)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (po is null) return NotFound();

        if (!Enum.TryParse<PurchaseOrderStatus>(dto.Status, true, out var status))
            return BadRequest(new { message = "Invalid status." });
        if (status is PurchaseOrderStatus.DeliveryInProgress or PurchaseOrderStatus.Delivered)
            return BadRequest(new { message = "Upload a proof-of-delivery batch to move a PO into delivery — it can't be set by hand." });

        po.Status = status;
        po.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Ok(ToDto(po));
    }

    private static readonly Dictionary<string, string> AllowedPhotoTypes = new()
    {
        ["image/jpeg"] = ".jpg",
        ["image/png"]  = ".png",
        ["image/webp"] = ".webp",
    };
    private const long MaxPhotoBytes = 5 * 1024 * 1024; // 5 MB

    // Saves one batch of proof-of-delivery photos. Can be called repeatedly —
    // each partial shipment gets its own batch — and moves an Approved PO
    // into DeliveryInProgress the first time it's called. Rating happens
    // separately (see Rate below), so this never touches the Evaluation.
    [HttpPost("{id:int}/delivery-batches")]
    [Authorize(Roles = DeliverRoles)]
    public async Task<IActionResult> AddDeliveryBatch(int id, [FromForm] SubmitDeliveryBatchDto dto)
    {
        var po = await db.PurchaseOrders
            .Include(p => p.Project).Include(p => p.Supplier).Include(p => p.Materials)
            .Include(p => p.DeliveryBatches).ThenInclude(b => b.Photos)
            .Include(p => p.DeliveryBatches).ThenInclude(b => b.UploadedBy)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (po is null) return NotFound();
        if (po.Status == PurchaseOrderStatus.Delivered)
            return BadRequest(new { message = "This PO has already been delivered." });
        if (po.Status == PurchaseOrderStatus.Pending)
            return BadRequest(new { message = "Approve this PO before recording a delivery." });
        if (dto.Photos.Count == 0)
            return BadRequest(new { message = "At least one proof-of-delivery photo is required." });

        var uploadsDir = Path.Combine(env.WebRootPath, "uploads", "deliveries");
        Directory.CreateDirectory(uploadsDir);

        var photos = new List<DeliveryBatchPhoto>();
        foreach (var file in dto.Photos)
        {
            if (file.Length == 0) continue;
            if (file.Length > MaxPhotoBytes)
                return BadRequest(new { message = "Each photo must be 5MB or smaller." });
            if (!AllowedPhotoTypes.TryGetValue(file.ContentType, out var ext))
                return BadRequest(new { message = "Only JPEG, PNG, or WebP images are allowed." });

            var fileName = $"{id}_{Guid.NewGuid():N}{ext}";
            await using (var stream = System.IO.File.Create(Path.Combine(uploadsDir, fileName)))
                await file.CopyToAsync(stream);
            photos.Add(new DeliveryBatchPhoto { Url = $"/uploads/deliveries/{fileName}" });
        }

        var nextBatchNumber = po.DeliveryBatches.Count == 0 ? 1 : po.DeliveryBatches.Max(b => b.BatchNumber) + 1;
        po.DeliveryBatches.Add(new DeliveryBatch
        {
            BatchNumber = nextBatchNumber,
            UploadedByUserId = CurrentUserId,
            Photos = photos,
        });

        po.Status = PurchaseOrderStatus.DeliveryInProgress;
        po.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        // UploadedBy on the newly-added batch isn't populated until reloaded —
        // ToDto needs it for DeliveryBatchDto.UploadedByName.
        await db.Entry(po.DeliveryBatches.Last()).Reference(b => b.UploadedBy).LoadAsync();

        return Ok(ToDto(po));
    }

    // Finalizes a delivery once every batch has arrived — requires at least
    // one photo across all batches, but not a rating (that's a separate,
    // WarehousePersonnel-only step; see Rate below).
    [HttpPost("{id:int}/complete-delivery")]
    [Authorize(Roles = DeliverRoles)]
    public async Task<IActionResult> CompleteDelivery(int id)
    {
        var po = await db.PurchaseOrders
            .Include(p => p.Project).Include(p => p.Supplier).Include(p => p.Materials)
            .Include(p => p.DeliveryBatches).ThenInclude(b => b.Photos)
            .Include(p => p.DeliveryBatches).ThenInclude(b => b.UploadedBy)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (po is null) return NotFound();
        if (po.Status != PurchaseOrderStatus.DeliveryInProgress)
            return BadRequest(new { message = "Save at least one delivery batch before completing delivery." });
        if (!po.DeliveryBatches.Any(b => b.Photos.Count > 0))
            return BadRequest(new { message = "At least one proof-of-delivery photo is required." });

        po.Status = PurchaseOrderStatus.Delivered;
        po.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Ok(ToDto(po));
    }

    // Rating is independent of how the delivery got here — it's submitted
    // once, only by WarehousePersonnel, only after the PO is Delivered. The
    // photos already sit on the PO's DeliveryBatches; this just copies their
    // URLs onto the evaluation so existing supplier-history rendering (which
    // reads Evaluation.Photos) doesn't need to know batches exist.
    [HttpPost("{id:int}/rate")]
    [Authorize(Roles = RateRoles)]
    public async Task<IActionResult> Rate(int id, [FromBody] SubmitRatingDto dto)
    {
        var po = await db.PurchaseOrders
            .Include(p => p.Project).Include(p => p.Supplier).Include(p => p.Materials)
            .Include(p => p.DeliveryBatches).ThenInclude(b => b.Photos)
            .Include(p => p.DeliveryBatches).ThenInclude(b => b.UploadedBy)
            .Include(p => p.Evaluation)
            .FirstOrDefaultAsync(p => p.Id == id);
        if (po is null) return NotFound();
        if (po.Status != PurchaseOrderStatus.Delivered)
            return BadRequest(new { message = "This PO hasn't been delivered yet." });
        if (po.Evaluation is not null)
            return BadRequest(new { message = "This PO has already been rated." });

        foreach (var rating in new[] { dto.PriceRating, dto.DeliveryRating, dto.QualityRating, dto.AccuracyRating, dto.ResponsivenessRating })
        {
            if (rating is < 1 or > 5)
                return BadRequest(new { message = "All category ratings must be between 1 and 5." });
        }

        db.DeliveryEvaluations.Add(new DeliveryEvaluation
        {
            PurchaseOrderId = po.Id,
            PriceRating = dto.PriceRating,
            DeliveryRating = dto.DeliveryRating,
            QualityRating = dto.QualityRating,
            AccuracyRating = dto.AccuracyRating,
            ResponsivenessRating = dto.ResponsivenessRating,
            OnTime = dto.OnTime,
            ActualLeadDays = dto.ActualLeadDays,
            Comments = string.IsNullOrWhiteSpace(dto.Comments) ? null : dto.Comments.Trim(),
            RatedByUserId = CurrentUserId,
            Photos = po.DeliveryBatches.SelectMany(b => b.Photos).Select(p => new DeliveryPhoto { Url = p.Url }).ToList(),
        });

        await db.SaveChangesAsync();

        return Ok(ToDto(po));
    }

    private static PurchaseOrderDto ToDto(PurchaseOrder po) => new()
    {
        Id = po.Id,
        Number = po.Number,
        ProjectId = po.ProjectId,
        ProjectName = po.Project.Name,
        SupplierId = po.SupplierId,
        SupplierName = po.Supplier.Name,
        Status = po.Status.ToString(),
        OrderDate = po.OrderDate,
        ExpectedDate = po.ExpectedDate,
        Materials = po.Materials.Select(m => new PurchaseOrderMaterialDto
        {
            Id = m.Id, Name = m.Name, Quantity = m.Quantity, Unit = m.Unit,
            MaterialId = m.MaterialId, BOQItemId = m.BOQItemId, PhaseId = m.PhaseId,
            PrimarySection = m.PrimarySection, SubCategory = m.SubCategory,
        }).ToList(),
        DeliveryBatches = po.DeliveryBatches
            .OrderBy(b => b.BatchNumber)
            .Select(b => new DeliveryBatchDto
            {
                Id = b.Id,
                BatchNumber = b.BatchNumber,
                UploadedByName = $"{b.UploadedBy.FirstName} {b.UploadedBy.LastName}",
                CreatedAt = b.CreatedAt,
                PhotoUrls = b.Photos.Select(p => p.Url).ToList(),
            }).ToList(),
        HasEvaluation = po.Evaluation is not null,
    };
}
