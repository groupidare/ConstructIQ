using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddHistoricalSupplyPoDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PoDate",
                table: "HistoricalMaterialSupplies",
                type: "datetime(6)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PoDate",
                table: "HistoricalMaterialSupplies");
        }
    }
}
