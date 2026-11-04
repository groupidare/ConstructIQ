namespace ConstructIQ.API.Services.Interfaces;

// Writes logged Excess into the warehouse Google Sheet's STOCK IN columns and
// approved redistributions into STOCK OUT — see ExcessSheetSyncService.
public interface IExcessSheetSync
{
    // False until GOOGLE_SERVICE_ACCOUNT_KEY_FILE and GOOGLE_SHEET_ID are set;
    // entries are only marked pending for the sheet while it's on.
    bool Enabled { get; }
    // Asks the worker to write what's pending now instead of at its next retry.
    void Trigger();
}
