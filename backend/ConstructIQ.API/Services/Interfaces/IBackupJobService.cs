using ConstructIQ.API.Models.DTOs.Backup;

namespace ConstructIQ.API.Services.Interfaces;

public interface IBackupJobService
{
    Task ReportAsync(BackupJobReportDto dto);
    Task<IEnumerable<BackupJobRunDto>> GetHistoryAsync(int take = 50);
    Task<BackupStatusDto> GetStatusAsync();
}
