using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestBoqRows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BOQItemId",
                table: "WarehouseRequests",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAdditional",
                table: "WarehouseRequests",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "WarehouseRequests",
                type: "varchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<int>(
                name: "BOQItemId",
                table: "MaterialRequests",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAdditional",
                table: "MaterialRequests",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseRequests_BOQItemId",
                table: "WarehouseRequests",
                column: "BOQItemId");

            migrationBuilder.CreateIndex(
                name: "IX_MaterialRequests_BOQItemId",
                table: "MaterialRequests",
                column: "BOQItemId");

            migrationBuilder.AddForeignKey(
                name: "FK_MaterialRequests_BOQItems_BOQItemId",
                table: "MaterialRequests",
                column: "BOQItemId",
                principalTable: "BOQItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_WarehouseRequests_BOQItems_BOQItemId",
                table: "WarehouseRequests",
                column: "BOQItemId",
                principalTable: "BOQItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // Existing requests go to their row only when that's certain: the
            // material has one row here, or exactly one of its rows records that
            // quantity as requested. The rest stay row-less, which counts for no
            // row of a material with several — see ProcurementCapCalculator.
            foreach (var (table, quantity) in new[] { ("WarehouseRequests", "RequestedQuantity"), ("MaterialRequests", "Quantity") })
            {
                migrationBuilder.Sql($@"
UPDATE {table} q
JOIN (SELECT ProjectId, MaterialId, MIN(Id) AS RowId, COUNT(*) AS RowCount
      FROM BOQItems GROUP BY ProjectId, MaterialId) r
  ON r.ProjectId = q.ProjectId AND r.MaterialId = q.MaterialId
SET q.BOQItemId = r.RowId
WHERE r.RowCount = 1;");

                migrationBuilder.Sql($@"
UPDATE {table} q
JOIN (SELECT p.Id AS RequestId, MIN(b.Id) AS RowId, COUNT(*) AS RowCount
      FROM {table} p
      JOIN BOQItems b ON b.ProjectId = p.ProjectId AND b.MaterialId = p.MaterialId AND b.RequestedQuantity = p.{quantity}
      WHERE p.BOQItemId IS NULL
      GROUP BY p.Id) r
  ON r.RequestId = q.Id
SET q.BOQItemId = r.RowId
WHERE r.RowCount = 1;");
            }

            // The row says what it's bought in; a request with no row can only
            // keep showing the catalog unit.
            migrationBuilder.Sql(@"
UPDATE WarehouseRequests w
JOIN BOQItems b ON b.Id = w.BOQItemId
SET w.Unit = COALESCE(NULLIF(b.EstimatedPurchaseUnit, ''), NULLIF(b.Unit, ''), '');");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MaterialRequests_BOQItems_BOQItemId",
                table: "MaterialRequests");

            migrationBuilder.DropForeignKey(
                name: "FK_WarehouseRequests_BOQItems_BOQItemId",
                table: "WarehouseRequests");

            migrationBuilder.DropIndex(
                name: "IX_WarehouseRequests_BOQItemId",
                table: "WarehouseRequests");

            migrationBuilder.DropIndex(
                name: "IX_MaterialRequests_BOQItemId",
                table: "MaterialRequests");

            migrationBuilder.DropColumn(
                name: "BOQItemId",
                table: "WarehouseRequests");

            migrationBuilder.DropColumn(
                name: "IsAdditional",
                table: "WarehouseRequests");

            migrationBuilder.DropColumn(
                name: "Unit",
                table: "WarehouseRequests");

            migrationBuilder.DropColumn(
                name: "BOQItemId",
                table: "MaterialRequests");

            migrationBuilder.DropColumn(
                name: "IsAdditional",
                table: "MaterialRequests");
        }
    }
}
