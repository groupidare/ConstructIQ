using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddForecastedMaterialUnit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Unit",
                table: "ForecastedMaterials",
                type: "varchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Unit",
                table: "ForecastedMaterials");
        }
    }
}
