using System.Text.RegularExpressions;
using ConstructIQ.API.Data;
using ConstructIQ.API.Models.Entities;
using Microsoft.EntityFrameworkCore;
using MySqlConnector;

namespace ConstructIQ.API.Algorithms;

// Sequential PO numbers in the client's own convention: PO-001, PO-002, …
// (at least three digits; PO-1000 follows PO-999). The next number continues
// from whichever is higher: the last sequential number issued, or how many
// POs exist in total — so the first sequential PO after the older random
// numbers ("PO-2026-4821") still follows on from the real count, and a
// deleted PO's number is never handed out again.
//
// Imported POs (made outside the system, see PurchaseOrder.IsImported) get
// their own IMP-001, IMP-002, … sequence by the same rules, and are never
// counted towards the PO-001… one.
//
// Duplicates are impossible: PurchaseOrders.Number has a unique index. When
// two POs are created at the same moment and both pick the same next number,
// the database rejects the second save, and it retries with fresh numbers.
public static class PoNumberGenerator
{
    private const int MaxAttempts = 5;
    // Up to six digits: a longer all-digit suffix isn't one of ours (an
    // imported or test number), and must not jump the sequence ahead.
    private static readonly Regex Sequential = new(@"^PO-(\d{1,6})$", RegexOptions.Compiled);
    private static readonly Regex ImportedSequential = new(@"^IMP-(\d{1,6})$", RegexOptions.Compiled);

    public static string Format(int n) => $"PO-{n:D3}";
    public static string FormatImported(int n) => $"IMP-{n:D3}";

    public static int? Parse(string? number) => ParseWith(Sequential, number);
    public static int? ParseImported(string? number) => ParseWith(ImportedSequential, number);

    private static int? ParseWith(Regex pattern, string? number)
    {
        var m = pattern.Match(number?.Trim() ?? string.Empty);
        return m.Success && int.TryParse(m.Groups[1].Value, out var n) ? n : null;
    }

    public static Task<int> NextAsync(AppDbContext db) => NextAsync(db, imported: false);
    public static Task<int> NextImportedAsync(AppDbContext db) => NextAsync(db, imported: true);

    private static async Task<int> NextAsync(AppDbContext db, bool imported)
    {
        var prefix = imported ? "IMP-" : "PO-";
        var count = await db.PurchaseOrders.CountAsync(p => p.IsImported == imported);
        var numbers = await db.PurchaseOrders
            .Where(p => p.Number.StartsWith(prefix))
            .Select(p => p.Number)
            .ToListAsync();
        var parse = imported ? (Func<string?, int?>)ParseImported : Parse;
        var lastSequential = numbers.Select(parse).Where(n => n.HasValue).Select(n => n!.Value).DefaultIfEmpty(0).Max();
        return Math.Max(lastSequential, count) + 1;
    }

    // Numbers the given new POs consecutively (in list order, each in its own
    // sequence) and saves every pending change in the context along with
    // them, retrying when another save took the same number first.
    public static async Task SaveWithNumbersAsync(AppDbContext db, IReadOnlyList<PurchaseOrder> newOrders)
    {
        for (var attempt = 1; ; attempt++)
        {
            var next = newOrders.Any(o => !o.IsImported) ? await NextAsync(db) : 0;
            var nextImported = newOrders.Any(o => o.IsImported) ? await NextImportedAsync(db) : 0;
            foreach (var order in newOrders)
                order.Number = order.IsImported ? FormatImported(nextImported++) : Format(next++);

            try
            {
                await db.SaveChangesAsync();
                return;
            }
            catch (DbUpdateException ex) when (attempt < MaxAttempts && IsDuplicateNumber(ex))
            {
                // Another PO took one of these numbers first — the entities are
                // still pending in the context, so just renumber and save again.
            }
        }
    }

    private static bool IsDuplicateNumber(DbUpdateException ex) =>
        ex.InnerException is MySqlException { ErrorCode: MySqlErrorCode.DuplicateKeyEntry } mysql
        && mysql.Message.Contains("Number", StringComparison.OrdinalIgnoreCase);
}
