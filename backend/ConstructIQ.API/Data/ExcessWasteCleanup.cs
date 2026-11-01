using System.Data;
using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;

namespace ConstructIQ.API.Data;

public sealed record ExcessWasteCleanupResult(int DeletedRecords, int DetachedRedistributionLinks);

/// <summary>
/// Explicit maintenance/seeding operation for this application's MySQL provider.
/// Stop all application writers and use a fresh, dedicated DbContext. Do not run
/// automatically on every startup. Master rows and BOQ actual quantities are preserved.
/// </summary>
public static class ExcessWasteCleanup
{
    public static async Task<ExcessWasteCleanupResult> ClearExcessAndWasteAsync(
        AppDbContext dbContext, CancellationToken cancellationToken = default)
    {
        if (dbContext.Database.ProviderName != "Pomelo.EntityFrameworkCore.MySql")
            throw new NotSupportedException("This method targets MySQL. Use the matching PostgreSQL or SQL Server cleanup script for those providers.");
        if (dbContext.Database.CurrentTransaction is not null || System.Transactions.Transaction.Current is not null)
            throw new InvalidOperationException("Use a dedicated context without an existing transaction; MySQL's identity reset implicitly commits.");
        if (dbContext.ChangeTracker.Entries().Any())
            throw new InvalidOperationException("Use a fresh context with no tracked entities for bulk cleanup.");

        var entity = dbContext.Model.FindEntityType(typeof(ExcessWasteRecord))!;
        var table = dbContext.GetService<ISqlGenerationHelper>()
            .DelimitIdentifier(entity.GetTableName()!, entity.GetSchema());

        int detached;
        int deleted;
        await using (var transaction = await dbContext.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken))
        {
            // Preserve transfer history, but prevent reused log IDs from linking
            // old transfers to newly seeded records. No other request fields change.
            detached = await dbContext.RedistributionRequests
                .Where(r => r.SourceExcessWasteRecordId != null)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.SourceExcessWasteRecordId, (int?)null), cancellationToken);
            deleted = await dbContext.ExcessWasteRecords.ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        // ALTER TABLE implicitly commits in MySQL; never claim this DDL can be
        // rolled back with the deletes. Keep all writers stopped until it finishes.
        try
        {
            // Identifier comes only from EF metadata and is provider-quoted, never user input.
#pragma warning disable EF1002
            await dbContext.Database.ExecuteSqlRawAsync($"ALTER TABLE {table} AUTO_INCREMENT = 1;", cancellationToken);
#pragma warning restore EF1002
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException(
                "Excess/waste deletion was committed, but the ID reset failed. Keep writers stopped and rerun cleanup before seeding. Master records were not changed.", exception);
        }

        return new ExcessWasteCleanupResult(deleted, detached);
    }
}
