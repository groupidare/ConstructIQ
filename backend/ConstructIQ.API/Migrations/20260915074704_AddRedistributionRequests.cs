using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddRedistributionRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RedistributionRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    MaterialId = table.Column<int>(type: "int", nullable: false),
                    SourceProjectId = table.Column<int>(type: "int", nullable: false),
                    TargetProjectId = table.Column<int>(type: "int", nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,4)", nullable: false),
                    UnitCost = table.Column<decimal>(type: "decimal(18,4)", nullable: false),
                    EstimatedSavings = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    AvailableExcessAtSource = table.Column<decimal>(type: "decimal(18,4)", nullable: false),
                    NeededQuantityAtTarget = table.Column<decimal>(type: "decimal(18,4)", nullable: false),
                    Priority = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    IsAiRecommended = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    Notes = table.Column<string>(type: "longtext", nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    RequestedByUserId = table.Column<int>(type: "int", nullable: true),
                    ApprovedByUserId = table.Column<int>(type: "int", nullable: true),
                    RequestedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    ApprovedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RedistributionRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RedistributionRequests_Materials_MaterialId",
                        column: x => x.MaterialId,
                        principalTable: "Materials",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RedistributionRequests_Projects_SourceProjectId",
                        column: x => x.SourceProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RedistributionRequests_Projects_TargetProjectId",
                        column: x => x.TargetProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RedistributionRequests_Users_ApprovedByUserId",
                        column: x => x.ApprovedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_RedistributionRequests_Users_RequestedByUserId",
                        column: x => x.RequestedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_RedistributionRequests_ApprovedByUserId",
                table: "RedistributionRequests",
                column: "ApprovedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RedistributionRequests_MaterialId",
                table: "RedistributionRequests",
                column: "MaterialId");

            migrationBuilder.CreateIndex(
                name: "IX_RedistributionRequests_RequestedByUserId",
                table: "RedistributionRequests",
                column: "RequestedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RedistributionRequests_SourceProjectId",
                table: "RedistributionRequests",
                column: "SourceProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_RedistributionRequests_TargetProjectId",
                table: "RedistributionRequests",
                column: "TargetProjectId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RedistributionRequests");
        }
    }
}
