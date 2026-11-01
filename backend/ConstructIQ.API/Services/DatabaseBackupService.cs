using System.Data;
using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage;

namespace ConstructIQ.API.Services;

// Logical data backup for the exact current EF schema. No uploaded SQL is executed,
// foreign keys stay enabled, and the whole restore commits or rolls back together.
public class DatabaseBackupService(AppDbContext db, IConfiguration config)
{
    public const int MaxBytes = 50 * 1024 * 1024;
    private byte[] Key => Encoding.UTF8.GetBytes(config["BACKUP_SIGNING_KEY"] ?? config["JWT_SECRET"]!);
    private static string Quote(string name) => "`" + name.Replace("`", "``") + "`";
    private record Table(IEntityType Entity, string Name, IProperty[] Properties);
    public record BackupData(int Version, DateTime CreatedAt, string Schema, string[] Migrations,
        Dictionary<string, List<Dictionary<string, JsonElement>>> Tables);
    public record BackupEnvelope(string Format, string Payload, string Signature);

    private List<Table> Tables()
    {
        var pending = db.Model.GetEntityTypes().ToList();
        var result = new List<Table>();
        while (pending.Count > 0)
        {
            var next = pending.FirstOrDefault(e => e.GetForeignKeys().All(f =>
                f.PrincipalEntityType == e || !pending.Contains(f.PrincipalEntityType)))
                ?? throw new InvalidOperationException("Cannot back up a schema with cyclic table dependencies.");
            result.Add(new Table(next, next.GetTableName()!, next.GetProperties().OrderBy(p => p.Name).ToArray()));
            pending.Remove(next);
        }
        return result;
    }

    private static string Schema(List<Table> tables) => Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(string.Join("|", tables.OrderBy(t => t.Name).Select(t =>
            t.Name + ":" + string.Join(",", t.Properties.Select(p => $"{p.GetColumnName()}:{p.GetColumnType()}:{p.IsNullable}")))))));

    private DbCommand Command(string sql)
    {
        var command = db.Database.GetDbConnection().CreateCommand();
        command.Transaction = db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = sql;
        command.CommandTimeout = 120;
        return command;
    }

    public async Task<(byte[] Bytes, DateTime CreatedAt)> CreateAsync(int userId, string? ip, CancellationToken ct)
    {
        var tables = Tables();
        var rows = new Dictionary<string, List<Dictionary<string, JsonElement>>>();
        var createdAt = DateTime.UtcNow;
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        long size = 0;
        foreach (var table in tables)
        {
            var records = new List<Dictionary<string, JsonElement>>();
            await using var command = Command($"SELECT {string.Join(",", table.Properties.Select(p => Quote(p.GetColumnName())))} FROM {Quote(table.Name)}");
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var row = new Dictionary<string, JsonElement>();
                for (var i = 0; i < table.Properties.Length; i++)
                    row[table.Properties[i].GetColumnName()] = JsonSerializer.SerializeToElement(reader.IsDBNull(i) ? null : reader.GetValue(i));
                size += JsonSerializer.SerializeToUtf8Bytes(row).Length;
                if (size > MaxBytes / 2) throw new InvalidOperationException("Database exceeds the logical backup size limit. Use the database administrator's backup tooling.");
                records.Add(row);
            }
            rows[table.Name] = records;
        }
        var data = new BackupData(1, createdAt, Schema(tables), (await db.Database.GetAppliedMigrationsAsync(ct)).ToArray(), rows);
        var payload = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(data));
        var signature = Convert.ToHexString(HMACSHA256.HashData(Key, Encoding.UTF8.GetBytes(payload)));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new BackupEnvelope("ConstructIQ.Database.v1", payload, signature));
        if (bytes.Length > MaxBytes) throw new InvalidOperationException("Backup exceeds the download size limit.");
        db.ActivityLogs.Add(new ActivityLog { UserId = userId, Action = "BACKUP_CREATED", EntityType = "System",
            CreatedAt = createdAt, IpAddress = ip, Details = "Database backup generated; uploaded files are stored separately." });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return (bytes, createdAt);
        });
    }

    public async Task RestoreAsync(Stream stream, int actorId, string actorName, string? ip, CancellationToken ct)
    {
        // Signature validation takes place before parsing any table values or changing data.
        var envelope = await JsonSerializer.DeserializeAsync<BackupEnvelope>(stream, cancellationToken: ct)
            ?? throw new InvalidOperationException("Empty backup.");
        if (envelope.Format != "ConstructIQ.Database.v1" || string.IsNullOrEmpty(envelope.Payload) ||
            envelope.Signature?.Length != 64 || !CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(envelope.Signature), HMACSHA256.HashData(Key, Encoding.UTF8.GetBytes(envelope.Payload))))
            throw new InvalidOperationException("Invalid backup signature. Use a backup generated by this installation.");
        var data = JsonSerializer.Deserialize<BackupData>(Convert.FromBase64String(envelope.Payload))
            ?? throw new InvalidOperationException("Invalid backup payload.");
        var tables = Tables();
        if (data.Version != 1 || data.Schema != Schema(tables) || data.Migrations is null || data.Tables is null ||
            !data.Migrations.SequenceEqual(await db.Database.GetAppliedMigrationsAsync(ct)) ||
            !data.Tables.Keys.Order().SequenceEqual(tables.Select(t => t.Name).Order()))
            throw new InvalidOperationException("Backup schema does not match this installation. Restore using the matching application version.");
        foreach (var table in tables)
        {
            if (data.Tables[table.Name] is null) throw new InvalidOperationException("Missing backup table.");
            foreach (var row in data.Tables[table.Name])
                if (row is null || !row.Keys.Order().SequenceEqual(table.Properties.Select(p => p.GetColumnName()).Order()))
                    throw new InvalidOperationException("Backup contains invalid columns.");
        }

        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        foreach (var table in tables.AsEnumerable().Reverse())
        {
            await using var command = Command($"DELETE FROM {Quote(table.Name)}");
            await command.ExecuteNonQueryAsync(ct);
        }
        foreach (var table in tables)
        foreach (var row in data.Tables[table.Name])
        {
            await using var command = Command($"INSERT INTO {Quote(table.Name)} ({string.Join(",", table.Properties.Select(p => Quote(p.GetColumnName())))}) VALUES ({string.Join(",", table.Properties.Select((_, i) => "@p" + i))})");
            for (var i = 0; i < table.Properties.Length; i++)
            {
                var property = table.Properties[i];
                var value = row[property.GetColumnName()];
                var type = property.GetTypeMapping().Converter?.ProviderClrType ?? property.ClrType;
                type = Nullable.GetUnderlyingType(type) ?? type;
                if (type.IsEnum) type = Enum.GetUnderlyingType(type);
                var parameter = command.CreateParameter();
                parameter.ParameterName = "@p" + i;
                parameter.Value = value.ValueKind == JsonValueKind.Null ? DBNull.Value : value.Deserialize(type) ?? DBNull.Value;
                command.Parameters.Add(parameter);
            }
            await command.ExecuteNonQueryAsync(ct);
        }
        // Never resurrect credentials for sessions/challenges from a historical backup.
        db.ChangeTracker.Clear();
        var users = await db.Users.ToListAsync(ct);
        if (!users.Any(u => u.IsActive && u.Role == UserRole.Admin))
            throw new InvalidOperationException("Backup must contain an active administrator.");
        foreach (var user in users)
        {
            user.SecurityStamp = Guid.NewGuid().ToString("N");
            user.PasswordChangeTokenId = user.PasswordChangeOtpHash = user.PasswordResetToken = user.MfaCode = user.MfaChallengeToken = user.PendingDeviceId = null;
            user.PasswordChangeExpiresAt = user.PasswordResetTokenExpiresAt = user.MfaCodeExpiresAt = null;
        }
        await db.TrustedDevices.ExecuteDeleteAsync(ct);
        db.ActivityLogs.Add(new ActivityLog { UserId = null, Action = "DATABASE_RESTORED", EntityType = "System",
            IpAddress = ip, Details = $"Restored backup from {data.CreatedAt:O}; requested by {actorName} (user {actorId}). All sessions revoked." });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        });
    }
}
