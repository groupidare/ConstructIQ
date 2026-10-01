using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class LinkPurchaseOrderMaterialsToBOQ : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "OrderDate",
                table: "PurchaseOrders",
                type: "datetime(6)",
                nullable: false,
                defaultValue: new DateTime(2020, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc));

            // Backfill existing rows with their creation date (best available data)
            // rather than leaving the placeholder default above — 0001-01-01 (EF's
            // usual auto-generated default) is outside MySQL's valid DATETIME range.
            migrationBuilder.Sql("UPDATE PurchaseOrders SET OrderDate = CreatedAt;");

            migrationBuilder.AddColumn<int>(
                name: "BOQItemId",
                table: "PurchaseOrderMaterials",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MaterialId",
                table: "PurchaseOrderMaterials",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PhaseId",
                table: "PurchaseOrderMaterials",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrimarySection",
                table: "PurchaseOrderMaterials",
                type: "varchar(100)",
                maxLength: 100,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<string>(
                name: "SubCategory",
                table: "PurchaseOrderMaterials",
                type: "varchar(100)",
                maxLength: 100,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrderMaterials_BOQItemId",
                table: "PurchaseOrderMaterials",
                column: "BOQItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrderMaterials_MaterialId",
                table: "PurchaseOrderMaterials",
                column: "MaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseOrderMaterials_PhaseId",
                table: "PurchaseOrderMaterials",
                column: "PhaseId");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseOrderMaterials_BOQItems_BOQItemId",
                table: "PurchaseOrderMaterials",
                column: "BOQItemId",
                principalTable: "BOQItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseOrderMaterials_Materials_MaterialId",
                table: "PurchaseOrderMaterials",
                column: "MaterialId",
                principalTable: "Materials",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseOrderMaterials_Phases_PhaseId",
                table: "PurchaseOrderMaterials",
                column: "PhaseId",
                principalTable: "Phases",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseOrderMaterials_BOQItems_BOQItemId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseOrderMaterials_Materials_MaterialId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseOrderMaterials_Phases_PhaseId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseOrderMaterials_BOQItemId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseOrderMaterials_MaterialId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseOrderMaterials_PhaseId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropColumn(
                name: "OrderDate",
                table: "PurchaseOrders");

            migrationBuilder.DropColumn(
                name: "BOQItemId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropColumn(
                name: "MaterialId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropColumn(
                name: "PhaseId",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropColumn(
                name: "PrimarySection",
                table: "PurchaseOrderMaterials");

            migrationBuilder.DropColumn(
                name: "SubCategory",
                table: "PurchaseOrderMaterials");
        }
    }
}
