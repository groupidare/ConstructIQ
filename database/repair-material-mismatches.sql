-- Repairs BOQItems whose Specification text names one material but is linked
-- to the wrong catalog MaterialId — the same mismatch pattern already fixed
-- individually for Aurora Neighborhood Market (repair-aurora-block-material.sql)
-- and Sampaguita Courtyard Residence, found to affect ~28 projects system-wide
-- across two material families (CHB 100mm vs 150mm, and the roofing sheet).
--
-- Safe by construction: only remaps a row when (a) a Material whose Name
-- exactly equals the row's own Specification already exists in the catalog,
-- and (b) the row has zero dependent ExcessWasteRecords/
-- HistoricalMaterialSupplies/PurchaseOrderMaterials — so no logged data ever
-- silently changes which material it's attributed to. Run the verification
-- SELECT after COMMIT to confirm zero mismatches remain.

START TRANSACTION;

UPDATE BOQItems b
JOIN Materials m ON m.Id = b.MaterialId
JOIN Materials correct ON correct.Name = b.Specification
SET b.MaterialId = correct.Id
WHERE b.Specification IS NOT NULL AND b.Specification != ''
  AND b.Specification != m.Name
  AND NOT EXISTS (SELECT 1 FROM ExcessWasteRecords e WHERE e.BOQItemId = b.Id)
  AND NOT EXISTS (SELECT 1 FROM HistoricalMaterialSupplies h WHERE h.BOQItemId = b.Id)
  AND NOT EXISTS (SELECT 1 FROM PurchaseOrderMaterials po WHERE po.BOQItemId = b.Id);

SELECT ROW_COUNT() AS rows_updated;

COMMIT;

-- Verification — should return 0 after COMMIT:
SELECT COUNT(*) AS remaining_mismatched
FROM BOQItems b
JOIN Materials m ON m.Id = b.MaterialId
WHERE b.Specification IS NOT NULL AND b.Specification != ''
  AND b.Specification != m.Name
  AND EXISTS (SELECT 1 FROM Materials m2 WHERE m2.Name = b.Specification);
