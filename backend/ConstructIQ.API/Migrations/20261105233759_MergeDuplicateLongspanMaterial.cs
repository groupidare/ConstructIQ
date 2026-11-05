using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    // One product was in the catalog twice, "0.5mm thick" and "0.50mm thick".
    // Past purchases and their prices are all on the first, current projects on
    // the second, so those projects found no price for their roofing. Everything
    // moves to the first. The duplicate is deactivated, not deleted. Matched by
    // exact name, so a database without both materials is left as it is.
    /// <inheritdoc />
    public partial class MergeDuplicateLongspanMaterial : Migration
    {
        private const string Duplicate = "Prepainted Rib-Type Longspan Steel Sheet, 0.50mm thick";
        private const string Kept = "Prepainted Rib-Type Longspan Steel Sheet, 0.5mm thick";

        // Every table with a foreign key to Materials, but InventoryRecords (below).
        private static readonly string[] MaterialTables =
        [
            "BOQItems", "ExcessWasteRecords", "ForecastedMaterials", "MaterialRequests", "Notifications",
            "ProcurementRecommendations", "PurchaseOrderMaterials", "PurchaseRequests", "RedistributionRequests", "WarehouseRequests",
        ];

        /// <summary>The statements that move everything from one material to another; public for its test.</summary>
        public static IEnumerable<string> MergeSql(string duplicate, string kept)
        {
            var pair = $"JOIN Materials f ON f.Name = '{duplicate}' JOIN Materials t ON t.Name = '{kept}'";
            foreach (var table in MaterialTables)
                yield return $"UPDATE {table} x {pair} SET x.MaterialId = t.Id WHERE x.MaterialId = f.Id;";
            // One record per project and material: a project already holding the
            // kept material keeps its record of the duplicate where it is.
            yield return $"UPDATE InventoryRecords x {pair} LEFT JOIN InventoryRecords y ON y.ProjectId = x.ProjectId AND y.MaterialId = t.Id "
                + "SET x.MaterialId = t.Id WHERE x.MaterialId = f.Id AND y.Id IS NULL;";
            yield return $"UPDATE Materials f JOIN Materials t ON t.Name = '{kept}' SET f.IsActive = 0 WHERE f.Name = '{duplicate}';";
        }

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var sql in MergeSql(Duplicate, Kept))
                migrationBuilder.Sql(sql);
        }

        // Which rows were moved isn't recorded; the database backup taken before
        // this deploy is the way back.
        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
