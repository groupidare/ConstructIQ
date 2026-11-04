using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddNoExcessWasteConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "NoExcessWasteConfirmedAt",
                table: "BOQItems",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NoExcessWasteConfirmedByUserId",
                table: "BOQItems",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NoExcessWasteConfirmedAt",
                table: "BOQItems");

            migrationBuilder.DropColumn(
                name: "NoExcessWasteConfirmedByUserId",
                table: "BOQItems");
        }
    }
}
