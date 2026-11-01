using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddMaterialPropertiesAndRoomPerimeter : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "PerimeterM",
                table: "Measurements",
                type: "decimal(10,3)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CalculationType",
                table: "Materials",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Coats",
                table: "Materials",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CoveragePerUnit",
                table: "Materials",
                type: "decimal(12,4)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CoverageUnit",
                table: "Materials",
                type: "varchar(20)",
                maxLength: 20,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<decimal>(
                name: "LengthMm",
                table: "Materials",
                type: "decimal(10,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "PiecesPerPackage",
                table: "Materials",
                type: "decimal(10,2)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PropertiesSource",
                table: "Materials",
                type: "varchar(200)",
                maxLength: 200,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<string>(
                name: "PurchaseUnit",
                table: "Materials",
                type: "varchar(20)",
                maxLength: 20,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<decimal>(
                name: "ThicknessMm",
                table: "Materials",
                type: "decimal(10,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "UnitLengthM",
                table: "Materials",
                type: "decimal(10,3)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "WidthMm",
                table: "Materials",
                type: "decimal(10,2)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PerimeterM",
                table: "Measurements");

            migrationBuilder.DropColumn(
                name: "CalculationType",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "Coats",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "CoveragePerUnit",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "CoverageUnit",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "LengthMm",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "PiecesPerPackage",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "PropertiesSource",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "PurchaseUnit",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "ThicknessMm",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "UnitLengthM",
                table: "Materials");

            migrationBuilder.DropColumn(
                name: "WidthMm",
                table: "Materials");
        }
    }
}
