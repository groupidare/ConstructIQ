using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestSubmittedForApproval : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "SubmittedForApprovalAt",
                table: "MaterialRequests",
                type: "datetime(6)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SubmittedForApprovalAt",
                table: "MaterialRequests");
        }
    }
}
