using System.Security.Claims;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.MaterialRequests;
using ConstructIQ.API.Models.DTOs.PurchaseOrders;
using ConstructIQ.API.Models.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/material-requests")]
[Authorize]
public class MaterialRequestsController(AppDbContext db) : ControllerBase
{
    // Same "manages procurement" set as PurchaseOrdersController — viewing
    // and fulfilling requests is a procurement action, not a site one.
    private const string ManageRoles = "Admin,ProjectManager,ProcurementOfficer";

    private int CurrentUserId =>
        int.Parse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value ?? "0");

    // No role restriction — mirrors the BOQ "Notify Procurement" button this
    // powers, which today has no restriction either. Anyone who can see a
    // project's Material Plan can flag a shortage to Procurement.
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateMaterialRequestDto dto)
    {
        if (dto.Quantity <= 0)
            return BadRequest(new { message = "Quantity must be greater than zero." });

        var project = await db.Projects.FindAsync(dto.ProjectId);
        if (project is null) return BadRequest(new { message = "Project not found." });

        var material = await db.Materials.FindAsync(dto.MaterialId);
        if (material is null) return BadRequest(new { message = "Material not found." });

        var remaining = await ProcurementCapCalculator.GetRemainingRequestableAsync(db, dto.ProjectId, dto.MaterialId);
        if (dto.Quantity > remaining)
            return BadRequest(new { message = $"Cannot request more than {remaining} {material.Unit} — that exceeds the estimated need minus what's already been redistributed in and requested." });

        var request = new MaterialRequest
        {
            ProjectId = dto.ProjectId,
            MaterialId = dto.MaterialId,
            Quantity = dto.Quantity,
            Unit = string.IsNullOrWhiteSpace(dto.Unit) ? material.Unit : dto.Unit.Trim(),
            RequestedByUserId = CurrentUserId,
        };

        db.MaterialRequests.Add(request);
        await db.SaveChangesAsync();

        return Ok(new { id = request.Id });
    }

    // Authoritative "how much more can still be requested" per material in
    // this project's BOQ — the Material Plan tab uses this directly instead
    // of re-deriving it client-side, so its displayed cap always matches
    // exactly what Create above will actually accept.
    [HttpGet("remaining/{projectId:int}")]
    public async Task<IActionResult> GetRemaining(int projectId)
    {
        var remaining = await ProcurementCapCalculator.GetRemainingRequestableForProjectAsync(db, projectId);
        return Ok(remaining.Select(kv => new { materialId = kv.Key, remaining = kv.Value }));
    }

    // Only projects with at least one unfulfilled request show up — the
    // Requests tab's whole premise is "nothing to see until there's something
    // to act on".
    [HttpGet("projects-with-pending")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> GetProjectsWithPending()
    {
        var groups = await db.MaterialRequests
            .Where(r => r.FulfilledByPurchaseOrderId == null)
            .GroupBy(r => new { r.ProjectId, r.Project.Name })
            .Select(g => new ProjectWithRequestsDto
            {
                ProjectId = g.Key.ProjectId,
                ProjectName = g.Key.Name,
                PendingCount = g.Count(),
            })
            .OrderBy(p => p.ProjectName)
            .ToListAsync();

        return Ok(groups);
    }

    [HttpGet("project/{projectId:int}")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> GetForProject(int projectId)
    {
        var requests = await db.MaterialRequests
            .Include(r => r.Material)
            .Include(r => r.RequestedBy)
            .Where(r => r.ProjectId == projectId && r.FulfilledByPurchaseOrderId == null)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync();

        return Ok(requests.Select(ToDto));
    }

    // Ranks every supplier for the dropdown next to one material row: suppliers
    // who've actually been ordered this exact material before come first
    // (by rating), then everyone else by overall rating — so a material with
    // no order history yet still gets a usable, non-empty list.
    [HttpGet("suggested-suppliers/{materialId:int}")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> GetSuggestedSuppliers(int materialId)
    {
        var supplierIdsWithHistory = (await db.PurchaseOrderMaterials
            .Include(m => m.PurchaseOrder)
            .Where(m => m.MaterialId == materialId)
            .Select(m => m.PurchaseOrder.SupplierId)
            .Distinct()
            .ToListAsync())
            .ToHashSet();

        var suppliers = await db.Suppliers
            .Include(s => s.PurchaseOrders).ThenInclude(po => po.Evaluation)
            .ToListAsync();

        var ranked = suppliers
            .Select(s =>
            {
                var (rating, onTimePct, deliveries) = ComputeStats(s);
                return new SuggestedSupplierDto
                {
                    Id = s.Id, Name = s.Name, Rating = rating, OnTimePct = onTimePct, Deliveries = deliveries,
                    HasHistoryWithMaterial = supplierIdsWithHistory.Contains(s.Id),
                };
            })
            .OrderByDescending(s => s.HasHistoryWithMaterial)
            .ThenByDescending(s => s.Rating)
            .ThenByDescending(s => s.OnTimePct)
            .ToList();

        return Ok(ranked);
    }

    // One PurchaseOrder per unique supplier named across the assignments —
    // materials sharing a supplier land on the same PO/number; a request is
    // only ever consumed by exactly one PO, so this can't double-fulfill.
    [HttpPost("generate-pos")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> GeneratePOs([FromBody] GeneratePOsFromRequestsDto dto)
    {
        if (dto.Assignments.Count == 0)
            return BadRequest(new { message = "No materials to generate purchase orders for." });
        if (dto.Assignments.Any(a => string.IsNullOrWhiteSpace(a.SupplierName)))
            return BadRequest(new { message = "Every material needs a supplier before generating purchase orders." });

        var project = await db.Projects.FindAsync(dto.ProjectId);
        if (project is null) return BadRequest(new { message = "Project not found." });

        var requestIds = dto.Assignments.Select(a => a.RequestId).ToList();
        var requests = await db.MaterialRequests
            .Include(r => r.Material)
            .Where(r => requestIds.Contains(r.Id) && r.ProjectId == dto.ProjectId && r.FulfilledByPurchaseOrderId == null)
            .ToListAsync();

        if (requests.Count != dto.Assignments.Count)
            return BadRequest(new { message = "One or more materials were already turned into a purchase order — refresh and try again." });

        var requestPoNumbers = new Dictionary<int, string>();
        var createdPOs = new List<PurchaseOrder>();

        foreach (var group in dto.Assignments.GroupBy(a => a.SupplierName.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            var supplierName = group.Key;
            var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Name.ToLower() == supplierName.ToLower());
            if (supplier is null)
            {
                supplier = new Supplier { Name = supplierName };
                db.Suppliers.Add(supplier);
            }

            var po = new PurchaseOrder
            {
                Number = $"PO-{DateTime.UtcNow.Year}-{Random.Shared.Next(1000, 9999)}",
                Project = project,
                Supplier = supplier,
                Status = PurchaseOrderStatus.Pending,
                ExpectedDate = dto.ExpectedDate,
                CreatedByUserId = CurrentUserId,
            };

            foreach (var assignment in group)
            {
                var request = requests.First(r => r.Id == assignment.RequestId);
                po.Materials.Add(new PurchaseOrderMaterial
                {
                    Name = request.Material.Name,
                    Quantity = request.Quantity,
                    Unit = request.Unit,
                    MaterialId = request.MaterialId,
                });
                request.FulfilledByPurchaseOrder = po;
                requestPoNumbers[request.Id] = po.Number;
            }

            db.PurchaseOrders.Add(po);
            createdPOs.Add(po);
        }

        await db.SaveChangesAsync();

        var reloadedIds = createdPOs.Select(p => p.Id).ToList();
        var reloaded = await db.PurchaseOrders
            .Include(p => p.Project).Include(p => p.Supplier).Include(p => p.Materials)
            .Where(p => reloadedIds.Contains(p.Id))
            .ToListAsync();

        return Ok(new GeneratedPOsResultDto
        {
            PurchaseOrders = reloaded.Select(ToPoDto).ToList(),
            RequestPoNumbers = requestPoNumbers,
        });
    }

    private static (double rating, int onTimePct, int deliveries) ComputeStats(Supplier s)
    {
        var deliveries = s.PurchaseOrders.Count(po => po.Status == PurchaseOrderStatus.Delivered);
        var rated = s.PurchaseOrders.Where(po => po.Evaluation != null).Select(po => po.Evaluation!).ToList();
        if (rated.Count == 0) return (0, 0, deliveries);

        var rating = rated.Average(e => (e.PriceRating + e.DeliveryRating + e.QualityRating + e.AccuracyRating + e.ResponsivenessRating) / 5.0);
        var onTimePct = (int)Math.Round(rated.Count(e => e.OnTime) * 100.0 / rated.Count);
        return (Math.Round(rating, 1), onTimePct, deliveries);
    }

    private static MaterialRequestDto ToDto(MaterialRequest r) => new()
    {
        Id = r.Id,
        MaterialId = r.MaterialId,
        MaterialName = r.Material.Name,
        Quantity = r.Quantity,
        Unit = r.Unit,
        RequestedByName = $"{r.RequestedBy.FirstName} {r.RequestedBy.LastName}",
        CreatedAt = r.CreatedAt,
    };

    private static PurchaseOrderDto ToPoDto(PurchaseOrder po) => new()
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
    };
}
