using ConstructIQ.API.Models.DTOs.Notification;

namespace ConstructIQ.API.Services.Interfaces;

public interface INotificationService
{
    Task<NotificationResponseDto> CreateAsync(NotificationCreateDto dto, int userId);
    Task<IEnumerable<NotificationResponseDto>> GetForRoleAsync(string role);
    Task<bool> MarkReadAsync(int id);
}
