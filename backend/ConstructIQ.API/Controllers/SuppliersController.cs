using ConstructIQ.API.Data;
using ConstructIQ.API.Models.DTOs.Suppliers;
using ConstructIQ.API.Models.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ConstructIQ.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SuppliersController(AppDbContext db) : ControllerBase
{
    // Returns full detail (including transaction history) for every supplier
    // in one call — the frontend keeps this as its single source of truth for
    // both the summary cards and the history/rating modals, so there's never
    // a second round-trip or a chance of the two views disagreeing.
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var suppliers = await db.Suppliers
            .Include(s => s.PurchaseOrders).ThenInclude(po => po.Project)
            .Include(s => s.PurchaseOrders).ThenInclude(po => po.Evaluation).ThenInclude(e => e!.Photos)
            .Include(s => s.PurchaseOrders).ThenInclude(po => po.Evaluation).ThenInclude(e => e!.RatedBy)
            .OrderBy(s => s.Name)
            .ToListAsync();

        return Ok(suppliers.Select(ToDetailDto));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var supplier = await LoadSupplierAsync(id);
        if (supplier is null) return NotFound();
        return Ok(ToDetailDto(supplier));
    }

    // Contact info can only be edited by roles that own supplier relationships;
    // everyone else can still view it (see GetById).
    [HttpPut("{id:int}/contact")]
    [Authorize(Roles = "Admin,ProcurementOfficer")]
    public async Task<IActionResult> UpdateContact(int id, [FromBody] UpdateSupplierContactDto dto)
    {
        var supplier = await db.Suppliers.FindAsync(id);
        if (supplier is null) return NotFound();

        supplier.ContactEmail = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email.Trim();
        supplier.ContactPhone = string.IsNullOrWhiteSpace(dto.Phone) ? null : dto.Phone.Trim();
        await db.SaveChangesAsync();

        var reloaded = await LoadSupplierAsync(id);
        return Ok(ToDetailDto(reloaded!));
    }

    private async Task<Supplier?> LoadSupplierAsync(int id) =>
        await db.Suppliers
            .Include(s => s.PurchaseOrders).ThenInclude(po => po.Project)
            .Include(s => s.PurchaseOrders).ThenInclude(po => po.Evaluation).ThenInclude(e => e!.Photos)
            .Include(s => s.PurchaseOrders).ThenInclude(po => po.Evaluation).ThenInclude(e => e!.RatedBy)
            .FirstOrDefaultAsync(s => s.Id == id);

    private static (double rating, int onTimePct, int deliveries) ComputeStats(Supplier s)
    {
        var deliveries = s.PurchaseOrders.Count(po => po.Status == PurchaseOrderStatus.Delivered);
        var rated = s.PurchaseOrders.Where(po => po.Evaluation != null).Select(po => po.Evaluation!).ToList();
        if (rated.Count == 0) return (0, 0, deliveries);

        var rating = rated.Average(e => (e.PriceRating + e.DeliveryRating + e.QualityRating + e.AccuracyRating + e.ResponsivenessRating) / 5.0);
        var onTimePct = (int)Math.Round(rated.Count(e => e.OnTime) * 100.0 / rated.Count);
        return (Math.Round(rating, 1), onTimePct, deliveries);
    }

    private static SupplierDetailDto ToDetailDto(Supplier s)
    {
        var (rating, onTimePct, deliveries) = ComputeStats(s);
        return new SupplierDetailDto
        {
            Id = s.Id, Name = s.Name, Category = s.Category, Lead = s.Lead,
            ContactEmail = s.ContactEmail, ContactPhone = s.ContactPhone,
            Rating = rating, OnTimePct = onTimePct, Deliveries = deliveries,
            History = s.PurchaseOrders
                .OrderByDescending(po => po.CreatedAt)
                .Select(po => new SupplierHistoryEntryDto
                {
                    PoNumber = po.Number,
                    ProjectName = po.Project.Name,
                    Status = po.Status.ToString(),
                    ExpectedDate = po.ExpectedDate,
                    Evaluation = po.Evaluation is null ? null : new DeliveryEvaluationDto
                    {
                        PriceRating = po.Evaluation.PriceRating,
                        DeliveryRating = po.Evaluation.DeliveryRating,
                        QualityRating = po.Evaluation.QualityRating,
                        AccuracyRating = po.Evaluation.AccuracyRating,
                        ResponsivenessRating = po.Evaluation.ResponsivenessRating,
                        OnTime = po.Evaluation.OnTime,
                        ActualLeadDays = po.Evaluation.ActualLeadDays,
                        Comments = po.Evaluation.Comments,
                        RaterName = $"{po.Evaluation.RatedBy.FirstName} {po.Evaluation.RatedBy.LastName}",
                        PhotoUrls = po.Evaluation.Photos.Select(p => p.Url).ToList(),
                    },
                }).ToList(),
        };
    }
}
