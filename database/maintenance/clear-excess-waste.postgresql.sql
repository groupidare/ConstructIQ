-- PostgreSQL equivalent for this EF model, using public + quoted PascalCase names.
-- Not for the current MySQL deployment. Verify schema/names after a provider migration.
-- Stop writers and run with psql -v ON_ERROR_STOP=1.
BEGIN TRANSACTION;
LOCK TABLE public."RedistributionRequests", public."ExcessWasteRecords" IN ACCESS EXCLUSIVE MODE;
UPDATE public."RedistributionRequests"
SET "SourceExcessWasteRecordId" = NULL
WHERE "SourceExcessWasteRecordId" IS NOT NULL;
DELETE FROM public."ExcessWasteRecords";

-- DELETE preserves referencing tables; TRUNCATE CASCADE could erase transfer history.
-- Discover the owned serial/identity sequence; RESTART (unlike setval) rolls back.
DO $$
DECLARE sequence_name text;
BEGIN
    sequence_name := pg_get_serial_sequence('public."ExcessWasteRecords"', 'Id');
    IF sequence_name IS NULL THEN
        RAISE EXCEPTION 'ExcessWasteRecords.Id has no owned serial/identity sequence';
    END IF;
    EXECUTE format('ALTER SEQUENCE %s RESTART WITH 1', sequence_name::regclass);
END $$;
COMMIT;
