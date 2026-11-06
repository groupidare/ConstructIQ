using System.Security.Claims;
using ConstructIQ.API.Algorithms;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.MaterialRequests;
using ConstructIQ.API.Models.DTOs.PurchaseOrders;
using ConstructIQ.API.Models.DTOs.WarehouseRequests;
using ConstructIQ.API.Models.Entities;
using System.Linq.Expressions;
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

    // What the Requests tab still has to act on: not yet on a PO, and — for a
    // price check — no price saved yet.
    private static readonly Expression<Func<MaterialRequest, bool>> IsPending = r =>
        r.FulfilledByPurchaseOrderId == null && (!r.IsPriceInquiry || !r.Quotes.Any(q => q.UnitPrice != null));

    // No role restriction — mirrors the BOQ "Notify Procurement" button this
    // powers, which today has no restriction either. Anyone who can see a
    // project's Material Plan can flag a shortage to Procurement.
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateMaterialRequestDto dto)
    {
        MaterialRequest request;
        try
        {
            request = await AddRequestAsync(dto);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        await notifications.CreateForRoleAsync(UserRole.ProcurementOfficer, NotificationKind.ProcurementRequestSubmitted,
            request.IsAdditional
                ? $"{request.Project.Name} requested {dto.Quantity} {request.Unit} of {request.Material.Name} — an additional order beyond the estimate."
                : $"{request.Project.Name} requested {dto.Quantity} {request.Unit} of {request.Material.Name}.",
            CurrentUserId, projectId: dto.ProjectId, materialId: dto.MaterialId, actionLink: "/procurement");

        return Ok(new { id = request.Id, isAdditional = request.IsAdditional });
    }

    // Needs the whole plan filled in. From there each row stands alone, so one
    // that can't go doesn't hold the others back, and Procurement gets one
    // summary rather than a notification per material.
    [HttpPost("bulk")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> CreateBulk([FromBody] BulkRequestDto dto, [FromServices] Services.Interfaces.IProjectAccessService projectAccess)
    {
        var role = User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;
        if (!await projectAccess.CanEditProjectAsync(dto.ProjectId, CurrentUserId, role))
            return Forbid();

        var problem = await ProcurementCapCalculator.GetBulkRequestProblemAsync(db, dto.ProjectId);
        if (problem is not null)
            return Ok(dto.Items.Select(item => new BulkRequestResultDto { BOQItemId = item.BOQItemId, Error = problem }).ToList());

        var results = new List<BulkRequestResultDto>();
        string? projectName = null;
        foreach (var item in dto.Items)
        {
            try
            {
                var request = await AddRequestAsync(new CreateMaterialRequestDto
                {
                    ProjectId = dto.ProjectId, MaterialId = item.MaterialId, BOQItemId = item.BOQItemId,
                    Quantity = item.Quantity, Unit = item.Unit,
                });
                projectName = request.Project.Name;
                results.Add(new BulkRequestResultDto { BOQItemId = item.BOQItemId, Success = true });
            }
            catch (InvalidOperationException ex)
            {
                results.Add(new BulkRequestResultDto { BOQItemId = item.BOQItemId, Error = ex.Message });
            }
        }

        var sent = results.Count(r => r.Success);
        if (sent > 0)
            await notifications.CreateForRoleAsync(UserRole.ProcurementOfficer, NotificationKind.ProcurementRequestSubmitted,
                $"{projectName} requested {sent} material{(sent == 1 ? "" : "s")} from Procurement.",
                CurrentUserId, projectId: dto.ProjectId, actionLink: "/procurement");
        return Ok(results);
    }

    private async Task<MaterialRequest> AddRequestAsync(CreateMaterialRequestDto dto)
    {
        if (dto.Quantity <= 0)
            throw new InvalidOperationException("Quantity must be greater than zero.");

        var project = await db.Projects.FindAsync(dto.ProjectId)
            ?? throw new InvalidOperationException("Project not found.");

        var material = await db.Materials.FindAsync(dto.MaterialId)
            ?? throw new InvalidOperationException("Material not found.");

        var row = await ProcurementCapCalculator.FindRequestRowAsync(db, dto.BOQItemId, dto.ProjectId, dto.MaterialId);
        ProcurementCapCalculator.EnsureRowIsFilledIn(row);

        // No upper cap — a site can deliberately order beyond the BOQ
        // estimate (breakage, a design change, a buffer). Anything past the
        // remaining requestable balance is accepted as an intentional
        // additional order, and flagged as such to Procurement rather than
        // rejected. Notify Warehouse works the same way (WarehouseRequestService).
        var remaining = await ProcurementCapCalculator.GetRemainingRequestableAsync(db, dto.ProjectId, dto.MaterialId, row?.Id);
        // With no row and no purchase estimate there's only a BOQ measure to
        // compare with — 500 pc against 169 sq.m says nothing about being
        // beyond the estimate.
        var hasPurchaseEstimate = row is not null
            || await db.BOQItems.AnyAsync(b => b.ProjectId == dto.ProjectId && b.MaterialId == dto.MaterialId && b.EstimatedPurchaseQuantity != null);
        var isAdditional = hasPurchaseEstimate && dto.Quantity > remaining;

        var request = new MaterialRequest
        {
            ProjectId = dto.ProjectId,
            MaterialId = dto.MaterialId,
            Quantity = dto.Quantity,
            Unit = string.IsNullOrWhiteSpace(dto.Unit) ? material.Unit : dto.Unit.Trim(),
            BOQItemId = row?.Id,
            IsAdditional = isAdditional,
            RequestedByUserId = CurrentUserId,
        };

        db.MaterialRequests.Add(request);
        await db.SaveChangesAsync();

        request.Project = project;
        request.Material = material;
        return request;
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
    // to act on". ?priceInquiry=false is the Requests tab (material to order),
    // true the Quotations tab (price checks); left out, both.
    [HttpGet("projects-with-pending")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> GetProjectsWithPending([FromQuery] bool? priceInquiry = null)
    {
        var groups = await db.MaterialRequests
            .Where(IsPending)
            .Where(r => priceInquiry == null || r.IsPriceInquiry == priceInquiry)
            .GroupBy(r => new { r.ProjectId, r.Project.Name })
            .Select(g => new ProjectWithRequestsDto
            {
                ProjectId = g.Key.ProjectId,
                ProjectName = g.Key.Name,
                PendingCount = g.Count(),
                ForApprovalCount = g.Count(r => r.SubmittedForApprovalAt != null),
            })
            .OrderBy(p => p.ProjectName)
            .ToListAsync();

        return Ok(groups);
    }

    // For whoever can request materials for the project, unlike the worklist
    // below: everything asked for, on a PO or not, without prices or quotes.
    // A price check isn't asking for material, so it isn't one of these.
    [HttpGet("project/{projectId:int}/sent")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> GetSent(int projectId, [FromServices] Services.Interfaces.IProjectAccessService projectAccess)
    {
        var role = User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;
        if (!await projectAccess.CanEditProjectAsync(projectId, CurrentUserId, role))
            return Forbid();

        var sent = await db.MaterialRequests
            .Where(r => r.ProjectId == projectId && !r.IsPriceInquiry)
            .OrderByDescending(r => r.CreatedAt).ThenByDescending(r => r.Id)
            .Select(r => new
            {
                Dto = new SentMaterialRequestDto
                {
                    Id = r.Id, BOQItemId = r.BOQItemId, MaterialName = r.Material.Name,
                    Quantity = r.Quantity, Unit = r.Unit, IsAdditional = r.IsAdditional, CreatedAt = r.CreatedAt,
                    PoNumber = r.FulfilledByPurchaseOrder != null ? r.FulfilledByPurchaseOrder.Number : null,
                },
                PoStatus = r.FulfilledByPurchaseOrder != null ? (PurchaseOrderStatus?)r.FulfilledByPurchaseOrder.Status : null,
            })
            .ToListAsync();
        return Ok(sent.Select(r => r.Dto with { PoStatus = r.PoStatus?.ToString() }).ToList());
    }

    [HttpGet("project/{projectId:int}")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> GetForProject(int projectId, [FromQuery] bool? priceInquiry = null)
    {
        var requests = await db.MaterialRequests
            .Include(r => r.Material)
            .Include(r => r.RequestedBy)
            .Include(r => r.Quotes)
            .Where(r => r.ProjectId == projectId)
            .Where(IsPending)
            .Where(r => priceInquiry == null || r.IsPriceInquiry == priceInquiry)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync();

        var materialIds = requests.Select(r => r.MaterialId).Distinct().ToList();
        // "Last paid": the latest priced PO line, this system's or a historical project's.
        var pricedLines = (await db.PurchaseOrderMaterials
                .Where(m => m.UnitPrice != null && m.MaterialId != null && materialIds.Contains(m.MaterialId.Value))
                .Select(m => new { MaterialId = m.MaterialId!.Value, m.Unit, Price = m.UnitPrice!.Value, Supplier = (string?)m.PurchaseOrder.Supplier.Name, Date = m.PurchaseOrder.OrderDate })
                .ToListAsync())
            .Concat(await db.HistoricalMaterialSupplies
                .Where(h => h.UnitCost != null && materialIds.Contains(h.BOQItem.MaterialId))
                .Select(h => new { h.BOQItem.MaterialId, h.Unit, Price = h.UnitCost!.Value, Supplier = h.Supplier != null ? h.Supplier.Name : null, Date = h.PoDate ?? h.BOQItem.Project.TargetEndDate })
                .ToListAsync())
            .OrderByDescending(p => p.Date)
            .ToList();

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
            if (r.Quantity is <= 0)
                return BadRequest(new { message = "Quantity must be greater than zero." });
        }

        var ids = dto.Requests.Select(r => r.RequestId).ToList();
        var requests = await db.MaterialRequests
            .Include(r => r.Quotes)
            .Where(r => ids.Contains(r.Id) && r.ProjectId == projectId && r.FulfilledByPurchaseOrderId == null)
            .ToListAsync();
        if (requests.Count != ids.Distinct().Count())
            return BadRequest(new { message = "One or more materials were already turned into a purchase order — refresh and try again." });

        foreach (var r in dto.Requests)
        {
            var request = requests.First(x => x.Id == r.RequestId);
            ApplyQuotes(request, r.Quotes, r.Remarks);
            if (r.Quantity is { } qty) request.Quantity = qty;
            // Only a material with at least one priced supplier goes for
            // approval; one still missing them is saved as it is, to finish later.
            if (dto.Submit && !request.IsPriceInquiry
                && r.Quotes.Any(q => !string.IsNullOrWhiteSpace(q.SupplierName) && q.UnitPrice != null))
                request.SubmittedForApprovalAt ??= DateTime.UtcNow;
        }

        await db.SaveChangesAsync();
        return NoContent();
    }

    // "Request quotation" on the cost breakdown: every Material Plan material
    // still to be ordered that has no recorded price becomes a price check in
    // Procurement's Quotations tab, for the quantity still to order. One that's
    // already waiting for a quotation isn't sent twice. Open to whoever can
    // see the project's cost.
    [HttpPost("price-inquiries/{projectId:int}")]
    [Authorize(Roles = "Admin,ProjectManager,SiteEngineer")]
    public async Task<IActionResult> RequestQuotations(int projectId,
        [FromServices] Services.Interfaces.IMaterialCostService materialCost,
        [FromServices] Services.Interfaces.IProjectAccessService projectAccess)
    {
        var role = User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;
        if (!await projectAccess.CanViewProjectCostAsync(projectId, CurrentUserId, role))
            return Forbid();

        var cost = await materialCost.GetEstimatedMaterialCostAsync(projectId);
        if (cost is null) return NotFound(new { message = "Project not found." });

        // Every material still missing a price — rows still to be ordered,
        // ordered lines bought without one, and rows with no forecast yet
        // (asked per their catalog buying unit) — so newly added materials
        // can be sent any time. A price is per unit, so a line needs one.
        var needed = cost.Lines
            .Where(l => l.NeedsPrice && l.MaterialId.HasValue && !string.IsNullOrWhiteSpace(l.Unit))
            .ToList();
        if (needed.Count == 0)
            return Ok(new PriceInquiryResultDto());

        var created = 0;
        var already = 0;
        foreach (var group in needed.GroupBy(l => (MaterialId: l.MaterialId!.Value, Unit: CompletedProjectDemandRules.NormalizeUnit(l.Unit))))
        {
            if (group.Any(l => l.QuotationRequested))
            {
                already++;
                continue;
            }
            // A no-forecast row has no quantity to buy yet — 1 unit, marked price only.
            var quantity = group.Sum(l => l.RemainingQuantity > 0 ? l.RemainingQuantity : l.OrderedQuantity);
            db.MaterialRequests.Add(new MaterialRequest
            {
                ProjectId = projectId,
                MaterialId = group.Key.MaterialId,
                Quantity = quantity > 0 ? quantity : 1,
                Unit = group.First().Unit,
                Remarks = group.All(l => l.NoForecast) ? "Price only — no forecasted quantity yet" : null,
                RequestedByUserId = CurrentUserId,
                IsPriceInquiry = true,
            });
            created++;
        }

        if (created > 0)
        {
            await db.SaveChangesAsync();
            var projectName = await db.Projects.Where(p => p.Id == projectId).Select(p => p.Name).FirstAsync();
            await notifications.CreateForRoleAsync(UserRole.ProcurementOfficer, NotificationKind.ProcurementRequestSubmitted,
                $"{projectName}: {created} material{(created == 1 ? "" : "s")} need a price — add supplier quotations in the Quotations tab.",
                CurrentUserId, projectId: projectId, actionLink: "/procurement?tab=quotations");
        }
        return Ok(new PriceInquiryResultDto { Requested = created, AlreadyRequested = already });
    }

    // Removes a request that's no longer needed. Only a pending one — once a
    // PO covers it, the PO is the record of what was ordered.
    [HttpDelete("{id:int}")]
    [Authorize(Roles = ManageRoles)]
    public async Task<IActionResult> Delete(int id)
    {
        var request = await db.MaterialRequests.FindAsync(id);
        if (request is null) return NotFound(new { message = "Request not found." });
        if (request.FulfilledByPurchaseOrderId is not null)
            return BadRequest(new { message = "This material is already on a purchase order and can't be deleted." });

        db.MaterialRequests.Remove(request);  // its quotes cascade
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
        // Who has supplied this material, from this system's POs and from
        // historical projects' PO lines (HistoricalMaterialSupply, dated by
        // its PO DATE, else the project's end).
        var supplierIdsWithHistory = (await db.PurchaseOrderMaterials
            .Include(m => m.PurchaseOrder)
            .Where(m => m.MaterialId == materialId)
            .Select(m => m.PurchaseOrder.SupplierId)
            .Distinct()
            .ToListAsync())
            .Concat(await db.HistoricalMaterialSupplies
                .Where(h => h.BOQItem.MaterialId == materialId && h.SupplierId != null)
                .Select(h => h.SupplierId!.Value)
                .Distinct()
                .ToListAsync())
            .ToHashSet();

        var lastPrices = (string.IsNullOrWhiteSpace(unit) ? [] : (await db.PurchaseOrderMaterials
                .Where(m => m.MaterialId == materialId && m.UnitPrice != null)
                .Select(m => new SupplierPrice(m.PurchaseOrder.SupplierId, m.Unit, m.UnitPrice!.Value, m.PurchaseOrder.OrderDate))
                .ToListAsync())
            .Concat(await db.HistoricalMaterialSupplies
                .Where(h => h.BOQItem.MaterialId == materialId && h.SupplierId != null && h.UnitCost != null)
                .Select(h => new SupplierPrice(h.SupplierId!.Value, h.Unit, h.UnitCost!.Value, h.PoDate ?? h.BOQItem.Project.TargetEndDate))
                .ToListAsync()))
            .Where(p => SameUnit(p.Unit, unit))
            .GroupBy(p => p.SupplierId)
            // Each supplier's price on its latest PO; the lower one if two share that date.
            .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.Date.Date).ThenBy(p => p.Price).First());

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
            if (a.Quantity is <= 0)
                return BadRequest(new { message = "Quantity must be greater than zero." });
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
        if (requests.FirstOrDefault(r => r.IsPriceInquiry) is { } priceCheck)
            return BadRequest(new { message = $"{priceCheck.Material.Name} is a price check only — save its quotation instead of making a PO." });
        // A PO comes only from a saved request whose supplier was then chosen.
        if (requests.FirstOrDefault(r => r.SubmittedForApprovalAt == null) is { } draft)
            return BadRequest(new { message = $"{draft.Material.Name} hasn't been saved for approval yet — enter its suppliers and click Save Request first." });

        foreach (var a in dto.Assignments)
        {
            var request = requests.First(r => r.Id == a.RequestId);
            if (a.Quotes.Count > 0 || a.Remarks is not null)
                ApplyQuotes(request, a.Quotes, a.Remarks);
            if (a.Quantity is { } qty) request.Quantity = qty;
        }

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
                ExpectedDate = dto.ExpectedDate ?? await DefaultExpectedDateAsync(supplier),
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
                    // The Material Plan row it was requested for, so the PO line
                    // counts toward that row without linking it by hand.
                    BOQItemId = request.BOQItemId,
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

    public const int DefaultLeadDays = 7;

    // Today plus the supplier's average actual lead time from its rated
    // deliveries, rounded up; DefaultLeadDays for a supplier with none (or a
    // brand-new one). It's what marks a PO "Delayed" once it passes.
    private async Task<DateTime> DefaultExpectedDateAsync(Supplier supplier)
    {
        double? avg = supplier.Id == 0 ? null : await db.DeliveryEvaluations
            .Where(e => e.PurchaseOrder.SupplierId == supplier.Id && e.ActualLeadDays > 0)
            .AverageAsync(e => (double?)e.ActualLeadDays);
        var days = avg is { } a ? (int)Math.Ceiling(a) : DefaultLeadDays;
        return DateTime.UtcNow.Date.AddDays(days);
    }

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
        IsAdditional = r.IsAdditional,
        IsPriceInquiry = r.IsPriceInquiry,
        ForApproval = r.SubmittedForApprovalAt != null,
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
