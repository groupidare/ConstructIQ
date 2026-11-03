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
public class MaterialRequestsController(AppDbContext db, Services.Interfaces.INotificationService notifications) : ControllerBase
{
    // Same "manages procurement" set as PurchaseOrdersController —
    // ProjectManager is view-only for Procurement, so isn't included here.
    private const string ManageRoles = "Admin,ProcurementOfficer";

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

        // No upper cap — a site can deliberately order beyond the BOQ
        // estimate (breakage, a design change, a buffer). Anything past the
        // remaining requestable balance is accepted as an intentional
        // additional order, and flagged as such to Procurement rather than
        // rejected. Notify Warehouse keeps its own cap (WarehouseRequestService).
        var remaining = await ProcurementCapCalculator.GetRemainingRequestableAsync(db, dto.ProjectId, dto.MaterialId);
        var isAdditional = dto.Quantity > remaining;

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

        await notifications.CreateForRoleAsync(UserRole.ProcurementOfficer, NotificationKind.ProcurementRequestSubmitted,
            isAdditional
                ? $"{project.Name} requested {dto.Quantity} {request.Unit} of {material.Name} — an additional order beyond the estimate."
                : $"{project.Name} requested {dto.Quantity} {request.Unit} of {material.Name}.",
            CurrentUserId, projectId: dto.ProjectId, materialId: dto.MaterialId, actionLink: "/procurement");

        return Ok(new { id = request.Id, isAdditional });
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
            .Include(r => r.Quotes)
            .Where(r => r.ProjectId == projectId && r.FulfilledByPurchaseOrderId == null)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync();

        var materialIds = requests.Select(r => r.MaterialId).Distinct().ToList();
        var pricedLines = await db.PurchaseOrderMaterials
            .Where(m => m.UnitPrice != null && m.MaterialId != null && materialIds.Contains(m.MaterialId.Value))
            .OrderByDescending(m => m.PurchaseOrder.OrderDate).ThenByDescending(m => m.Id)
            .Select(m => new { MaterialId = m.MaterialId!.Value, m.Unit, Price = m.UnitPrice!.Value, Supplier = m.PurchaseOrder.Supplier.Name })
            .ToListAsync();

        return Ok(requests.Select(r =>
        {
            var last = pricedLines.FirstOrDefault(p => p.MaterialId == r.MaterialId && SameUnit(p.Unit, r.Unit));
            return ToDto(r) with { LastUnitPrice = last?.Price, LastUnitPriceSupplier = last?.Supplier };
        }));
    }

    // Saves the supplier quotes and remarks on the form without generating a
    // PO, so a half-finished comparison isn't lost when the form is closed.
    [HttpPut("project/{projectId:int}/quotes")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> SaveQuotes(int projectId, [FromBody] SaveRequestQuotesDto dto)
    {
        foreach (var r in dto.Requests)
        {
            if (ValidateQuotes(r.Quotes, requireSelection: false) is { } error)
                return BadRequest(new { message = error });
        }

        var ids = dto.Requests.Select(r => r.RequestId).ToList();
        var requests = await db.MaterialRequests
            .Include(r => r.Quotes)
            .Where(r => ids.Contains(r.Id) && r.ProjectId == projectId && r.FulfilledByPurchaseOrderId == null)
            .ToListAsync();
        if (requests.Count != ids.Distinct().Count())
            return BadRequest(new { message = "One or more materials were already turned into a purchase order — refresh and try again." });

        foreach (var r in dto.Requests)
            ApplyQuotes(requests.First(x => x.Id == r.RequestId), r.Quotes, r.Remarks);

        await db.SaveChangesAsync();
        return NoContent();
    }

    // Ranks every supplier for the dropdown next to one material row: suppliers
    // who've actually been ordered this exact material before come first
    // (by rating), then everyone else by overall rating — so a material with
    // no order history yet still gets a usable, non-empty list.
    // With ?unit=, each supplier also carries its own last price for this
    // material in that unit — what the quote auto-fills when it's picked.
    [HttpGet("suggested-suppliers/{materialId:int}")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> GetSuggestedSuppliers(int materialId, [FromQuery] string? unit = null)
    {
        var supplierIdsWithHistory = (await db.PurchaseOrderMaterials
            .Include(m => m.PurchaseOrder)
            .Where(m => m.MaterialId == materialId)
            .Select(m => m.PurchaseOrder.SupplierId)
            .Distinct()
            .ToListAsync())
            .ToHashSet();

        var lastPrices = (string.IsNullOrWhiteSpace(unit) ? [] : await db.PurchaseOrderMaterials
                .Where(m => m.MaterialId == materialId && m.UnitPrice != null)
                .OrderByDescending(m => m.PurchaseOrder.OrderDate).ThenByDescending(m => m.Id)
                .Select(m => new SupplierPrice(m.PurchaseOrder.SupplierId, m.Unit, m.UnitPrice!.Value, m.PurchaseOrder.OrderDate))
                .ToListAsync())
            .Where(p => SameUnit(p.Unit, unit))
            .GroupBy(p => p.SupplierId)
            .ToDictionary(g => g.Key, g => g.First());

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
                    LastUnitPrice = lastPrices.GetValueOrDefault(s.Id)?.Price,
                    LastPriceDate = lastPrices.GetValueOrDefault(s.Id)?.Date,
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
        if (dto.Assignments.Any(a => a.UnitPrice < 0))
            return BadRequest(new { message = "Unit prices can't be negative." });

        var project = await db.Projects.FindAsync(dto.ProjectId);
        if (project is null) return BadRequest(new { message = "Project not found." });

        foreach (var a in dto.Assignments)
        {
            if (ValidateQuotes(a.Quotes, requireSelection: true) is { } error)
                return BadRequest(new { message = error });
            // The selected quote is what the PO is raised against — it must
            // be the supplier and price sent for this material.
            var selected = a.Quotes.FirstOrDefault(q => q.IsSelected);
            if (selected is not null && (!string.Equals(selected.SupplierName.Trim(), a.SupplierName.Trim(), StringComparison.OrdinalIgnoreCase)
                                         || selected.UnitPrice != a.UnitPrice))
                return BadRequest(new { message = "The selected supplier quote doesn't match the supplier and price for one of the materials." });
        }

        var requestIds = dto.Assignments.Select(a => a.RequestId).ToList();
        var requests = await db.MaterialRequests
            .Include(r => r.Material)
            .Include(r => r.Quotes)
            .Where(r => requestIds.Contains(r.Id) && r.ProjectId == dto.ProjectId && r.FulfilledByPurchaseOrderId == null)
            .ToListAsync();

        if (requests.Count != dto.Assignments.Count)
            return BadRequest(new { message = "One or more materials were already turned into a purchase order — refresh and try again." });

        foreach (var a in dto.Assignments.Where(a => a.Quotes.Count > 0 || a.Remarks is not null))
            ApplyQuotes(requests.First(r => r.Id == a.RequestId), a.Quotes, a.Remarks);

        var requestPos = new Dictionary<int, PurchaseOrder>();
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
                // Assigned on save — see PoNumberGenerator.
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
                    UnitPrice = assignment.UnitPrice,
                });
                request.FulfilledByPurchaseOrder = po;
                requestPos[request.Id] = po;
            }

            db.PurchaseOrders.Add(po);
            createdPOs.Add(po);
        }

        await PoNumberGenerator.SaveWithNumbersAsync(db, createdPOs);
        var requestPoNumbers = requestPos.ToDictionary(kv => kv.Key, kv => kv.Value.Number);

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

    private sealed record SupplierPrice(int SupplierId, string Unit, decimal Price, DateTime Date);

    // pc/pcs/piece variants and case count as the same unit — never a
    // conversion between different units.
    private static bool SameUnit(string? a, string? b) =>
        CompletedProjectDemandRules.NormalizeUnit(a) == CompletedProjectDemandRules.NormalizeUnit(b);

    // Null when valid. requireSelection: generating a PO needs exactly one
    // chosen quote (when any are given); saving a draft allows none.
    private static string? ValidateQuotes(List<MaterialRequestQuoteDto> quotes, bool requireSelection)
    {
        if (quotes.Count > MaterialRequest.MaxQuotes)
            return $"At most {MaterialRequest.MaxQuotes} suppliers can be quoted per material.";
        if (quotes.Any(q => string.IsNullOrWhiteSpace(q.SupplierName)))
            return "Every quote needs a supplier name.";
        if (quotes.Any(q => q.Slot < 1 || q.Slot > MaterialRequest.MaxQuotes) || quotes.Select(q => q.Slot).Distinct().Count() != quotes.Count)
            return "Each supplier quote needs its own column (1 to 3).";
        if (quotes.Select(q => q.SupplierName.Trim().ToLowerInvariant()).Distinct().Count() != quotes.Count)
            return "The same supplier is quoted twice for one material.";
        if (quotes.Any(q => q.UnitPrice < 0))
            return "Unit prices can't be negative.";
        var selected = quotes.Count(q => q.IsSelected);
        if (selected > 1)
            return "Only one supplier can be chosen per material.";
        if (requireSelection && quotes.Count > 0 && selected == 0)
            return "Choose which supplier to order each material from.";
        return null;
    }

    // Makes the request's quotes match the given ones (an empty list clears
    // them). Updated in place by slot rather than deleted and re-inserted, so
    // the (request, slot) unique index can't trip mid-save.
    private void ApplyQuotes(MaterialRequest request, List<MaterialRequestQuoteDto> quotes, string? remarks)
    {
        var bySlot = quotes.ToDictionary(q => q.Slot);
        foreach (var stale in request.Quotes.Where(q => !bySlot.ContainsKey(q.Slot)).ToList())
        {
            request.Quotes.Remove(stale);
            db.MaterialRequestQuotes.Remove(stale);
        }
        foreach (var q in quotes)
        {
            var quote = request.Quotes.FirstOrDefault(x => x.Slot == q.Slot);
            if (quote is null)
            {
                quote = new MaterialRequestQuote { Slot = q.Slot };
                request.Quotes.Add(quote);
            }
            quote.SupplierName = q.SupplierName.Trim();
            quote.UnitPrice = q.UnitPrice;
            quote.PriceFromHistory = q.PriceFromHistory;
            quote.IsSelected = q.IsSelected;
            quote.UpdatedAt = DateTime.UtcNow;
        }
        request.Remarks = string.IsNullOrWhiteSpace(remarks) ? null : remarks.Trim();
    }

    private static MaterialRequestDto ToDto(MaterialRequest r) => new()
    {
        Id = r.Id,
        MaterialId = r.MaterialId,
        MaterialName = r.Material.Name,
        Specification = r.Material.Specification,
        Quantity = r.Quantity,
        Unit = r.Unit,
        RequestedByName = $"{r.RequestedBy.FirstName} {r.RequestedBy.LastName}",
        CreatedAt = r.CreatedAt,
        Remarks = r.Remarks,
        Quotes = r.Quotes.OrderBy(q => q.Slot).Select(q => new MaterialRequestQuoteDto
        {
            Slot = q.Slot, SupplierName = q.SupplierName, UnitPrice = q.UnitPrice,
            PriceFromHistory = q.PriceFromHistory, IsSelected = q.IsSelected,
        }).ToList(),
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
            // Only reachable by ManageRoles (Admin/ProcurementOfficer), who may see prices.
            UnitPrice = m.UnitPrice,
        }).ToList(),
    };
}
