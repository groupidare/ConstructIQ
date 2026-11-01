using ConstructIQ.API.Models.DTOs.Notification;
using ConstructIQ.API.Models.Entities;

namespace ConstructIQ.API.Services.Interfaces;

public interface INotificationService
{
    Task<NotificationResponseDto> CreateAsync(NotificationCreateDto dto, int userId);

    // The one entry point every automatic trigger (redistribution, procurement,
    // weather, ...) calls. title defaults per-Kind when omitted so call-sites
    // don't all need to restate boilerplate copy.
    Task CreateForRoleAsync(UserRole recipientRole, NotificationKind kind, string message, int createdByUserId,
        int? projectId = null, int? materialId = null, decimal? quantity = null, string? title = null, string? actionLink = null);

    Task<IEnumerable<NotificationResponseDto>> GetMineAsync(int userId, string role);
    Task<bool> MarkReadAsync(int id, int userId);
}
