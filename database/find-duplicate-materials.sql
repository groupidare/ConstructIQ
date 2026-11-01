-- Finds materials catalog rows that collide once normalized the same way
-- DocumentService.ParseAsync/ParsePOAsync match scanned BOQ/PO line items to
-- the catalog: TRIM() + LOWER(). Two rows differing only by case or leading/
-- trailing whitespace (e.g. "PPR Water Pipe, 20mm dia. x 4m" vs
-- "ppr water pipe, 20mm dia. x 4m ") pass materials.Name's UNIQUE-free schema
-- fine, but crashed document scanning in production (ArgumentException: An
-- item with the same key has already been added) before the 2026-10-02 fix
-- that made those lookups collision-safe. The app no longer crashes on this,
-- but a collision still means one of the two rows is silently unreachable by
-- name-matched auto-fill — worth cleaning up by hand.
--
-- Read-only. Review each group below, decide which Id to keep, then merge by
-- hand (repoint any FK rows — boqitems.MaterialId, purchaseordermaterials.
-- MaterialId, materialrequests.MaterialId, etc. — to the surviving Id, then
-- delete the other). No automatic merge here: picking the "right" surviving
-- row (price, category, spec) isn't something to infer blindly.

SELECT
    LOWER(TRIM(Name)) AS normalized_name,
    COUNT(*)          AS duplicate_count,
    GROUP_CONCAT(Id ORDER BY Id)   AS material_ids,
    GROUP_CONCAT(Name ORDER BY Id SEPARATOR ' | ') AS raw_names
FROM materials
GROUP BY LOWER(TRIM(Name))
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, normalized_name;
