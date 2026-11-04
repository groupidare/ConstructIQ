using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddRedistributionSheetSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SheetSyncError",
                table: "RedistributionRequests",
                type: "varchar(300)",
                maxLength: 300,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<bool>(
                name: "SheetSyncPending",
                table: "RedistributionRequests",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "SheetSyncedAt",
                table: "RedistributionRequests",
                type: "datetime(6)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SheetSyncError",
                table: "RedistributionRequests");

            migrationBuilder.DropColumn(
                name: "SheetSyncPending",
                table: "RedistributionRequests");

            migrationBuilder.DropColumn(
                name: "SheetSyncedAt",
                table: "RedistributionRequests");
        }
    }
}
