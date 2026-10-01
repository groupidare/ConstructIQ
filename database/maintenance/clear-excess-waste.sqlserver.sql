-- SQL Server equivalent for this EF model, using dbo + PascalCase names.
-- Not for the current MySQL deployment. Verify schema/names after a provider migration.
-- Stop application writers. Assumes the normal IDENTITY(1,1) key.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @lockedRows bigint;
    SELECT @lockedRows = COUNT_BIG(*) FROM dbo.RedistributionRequests WITH (TABLOCKX, HOLDLOCK);
    SELECT @lockedRows = COUNT_BIG(*) FROM dbo.ExcessWasteRecords WITH (TABLOCKX, HOLDLOCK);

    IF NOT EXISTS (
        SELECT 1 FROM sys.identity_columns
        WHERE object_id = OBJECT_ID(N'dbo.ExcessWasteRecords') AND name = N'Id'
          AND CONVERT(bigint, seed_value) = 1 AND CONVERT(bigint, increment_value) = 1
    )
        THROW 50001, 'Expected ExcessWasteRecords.Id to be IDENTITY(1,1).', 1;

    -- Fresh/truncated tables already start at 1. Leave them alone so empty
    -- reruns do not change their initial identity state. DELETE-emptied tables
    -- with a previous identity value use reseed + 1.
    DECLARE @pristine bit = CASE WHEN EXISTS (
        SELECT 1 FROM sys.identity_columns
        WHERE object_id = OBJECT_ID(N'dbo.ExcessWasteRecords') AND name = N'Id' AND last_value IS NULL
    ) THEN 1 ELSE 0 END;

    UPDATE dbo.RedistributionRequests
    SET SourceExcessWasteRecordId = NULL
    WHERE SourceExcessWasteRecordId IS NOT NULL;
    DELETE FROM dbo.ExcessWasteRecords;

    IF @pristine = 0
        DBCC CHECKIDENT ('dbo.ExcessWasteRecords', RESEED, 0) WITH NO_INFOMSGS;
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
