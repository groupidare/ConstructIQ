-- Repair the verified interior-partition mapping without modifying quantities.
START TRANSACTION;
INSERT INTO materials (Name, Specification, Unit, CategoryId, UnitCost, IsActive)
SELECT 'Concrete Hollow Block, 100mm, Class A', 'Concrete Hollow Block, 100mm, Class A', 'pc', source.CategoryId, 0, 1
FROM materials source
WHERE source.Id = 126
  AND NOT EXISTS (SELECT 1 FROM materials WHERE Name = 'Concrete Hollow Block, 100mm, Class A');

UPDATE boqitems b
JOIN projects p ON p.Id = b.ProjectId
JOIN materials correct ON correct.Name = 'Concrete Hollow Block, 100mm, Class A' AND correct.Unit = 'pc'
SET b.MaterialId = correct.Id
WHERE b.Id = 4299 AND b.MaterialId = 126
  AND p.Name = 'Aurora Neighborhood Market'
  AND b.Specification = 'Concrete Hollow Block, 100mm, Class A'
  AND NOT EXISTS (SELECT 1 FROM excesswasterecords e WHERE e.BOQItemId = b.Id)
  AND NOT EXISTS (SELECT 1 FROM historicalmaterialsupplies h WHERE h.BOQItemId = b.Id)
  AND NOT EXISTS (SELECT 1 FROM purchaseordermaterials po WHERE po.BOQItemId = b.Id);
COMMIT;
