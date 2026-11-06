namespace ConstructIQ.API.Algorithms;

// Which logged Excess a warehouse release used up. The warehouse's balance can't
// tell whose excess a piece was, so the oldest goes first: 75 pc out of 50 from
// one project and 50 from another takes all of the first and 25 of the second.
// Whatever's beyond the excess came from the warehouse's regular stock.
public static class OldestExcessFirst
{
    public sealed record Available(int RecordId, decimal Quantity);
    public sealed record Taken(int RecordId, decimal Quantity);

    // oldestFirst: in the order to use them up.
    public static List<Taken> Allocate(IEnumerable<Available> oldestFirst, decimal quantity)
    {
        var taken = new List<Taken>();
        var left = quantity;
        foreach (var record in oldestFirst)
        {
            if (left <= 0) break;
            var amount = Math.Min(left, record.Quantity);
            if (amount <= 0) continue;
            taken.Add(new Taken(record.RecordId, amount));
            left -= amount;
        }
        return taken;
    }
}
