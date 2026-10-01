using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class MakeProjectDeleteCascade : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseOrders_Projects_ProjectId",
                table: "PurchaseOrders");

            migrationBuilder.DropForeignKey(
                name: "FK_RedistributionRequests_Projects_SourceProjectId",
                table: "RedistributionRequests");

            migrationBuilder.DropForeignKey(
                name: "FK_RedistributionRequests_Projects_TargetProjectId",
                table: "RedistributionRequests");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseOrders_Projects_ProjectId",
                table: "PurchaseOrders",
                column: "ProjectId",
                principalTable: "Projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_RedistributionRequests_Projects_SourceProjectId",
                table: "RedistributionRequests",
                column: "SourceProjectId",
                principalTable: "Projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_RedistributionRequests_Projects_TargetProjectId",
                table: "RedistributionRequests",
                column: "TargetProjectId",
                principalTable: "Projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseOrders_Projects_ProjectId",
                table: "PurchaseOrders");

            migrationBuilder.DropForeignKey(
                name: "FK_RedistributionRequests_Projects_SourceProjectId",
                table: "RedistributionRequests");

            migrationBuilder.DropForeignKey(
                name: "FK_RedistributionRequests_Projects_TargetProjectId",
                table: "RedistributionRequests");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseOrders_Projects_ProjectId",
                table: "PurchaseOrders",
                column: "ProjectId",
                principalTable: "Projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_RedistributionRequests_Projects_SourceProjectId",
                table: "RedistributionRequests",
                column: "SourceProjectId",
                principalTable: "Projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_RedistributionRequests_Projects_TargetProjectId",
                table: "RedistributionRequests",
                column: "TargetProjectId",
                principalTable: "Projects",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
