using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddWarehouseReleaseSources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SheetSyncError",
                table: "WarehouseRequests",
                type: "varchar(300)",
                maxLength: 300,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<bool>(
                name: "SheetSyncPending",
                table: "WarehouseRequests",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "SheetSyncedAt",
                table: "WarehouseRequests",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WarehouseReleaseSources",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    WarehouseRequestId = table.Column<int>(type: "int", nullable: false),
                    ExcessWasteRecordId = table.Column<int>(type: "int", nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,4)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WarehouseReleaseSources", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WarehouseReleaseSources_ExcessWasteRecords_ExcessWasteRecord~",
                        column: x => x.ExcessWasteRecordId,
                        principalTable: "ExcessWasteRecords",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WarehouseReleaseSources_WarehouseRequests_WarehouseRequestId",
                        column: x => x.WarehouseRequestId,
                        principalTable: "WarehouseRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseReleaseSources_ExcessWasteRecordId",
                table: "WarehouseReleaseSources",
                column: "ExcessWasteRecordId");

            migrationBuilder.CreateIndex(
                name: "IX_WarehouseReleaseSources_WarehouseRequestId",
                table: "WarehouseReleaseSources",
                column: "WarehouseRequestId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WarehouseReleaseSources");

            migrationBuilder.DropColumn(
                name: "SheetSyncError",
                table: "WarehouseRequests");

            migrationBuilder.DropColumn(
                name: "SheetSyncPending",
                table: "WarehouseRequests");

            migrationBuilder.DropColumn(
                name: "SheetSyncedAt",
                table: "WarehouseRequests");
        }
    }
}
