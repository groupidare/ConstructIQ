-- Current ConstructIQ provider: MySQL 8 / InnoDB.
-- Stop ALL application writers; select the intended database before running.
-- Run with a client that stops on the first error (mysql without --force).
-- On a transaction error: ROLLBACK and do not execute the identity reset.
-- No master-table rows or BOQ quantities are changed.
START TRANSACTION;
UPDATE `RedistributionRequests`
SET `SourceExcessWasteRecordId` = NULL
WHERE `SourceExcessWasteRecordId` IS NOT NULL;
DELETE FROM `ExcessWasteRecords`;
COMMIT;

-- MySQL DDL implicitly commits: reset is a separate, post-commit operation.
-- If this fails, the deletions remain committed. Rerun while writers are stopped.
ALTER TABLE `ExcessWasteRecords` AUTO_INCREMENT = 1;
