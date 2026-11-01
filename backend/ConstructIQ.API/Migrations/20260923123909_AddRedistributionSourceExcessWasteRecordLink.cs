using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddRedistributionSourceExcessWasteRecordLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SourceExcessWasteRecordId",
                table: "RedistributionRequests",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_RedistributionRequests_SourceExcessWasteRecordId",
                table: "RedistributionRequests",
                column: "SourceExcessWasteRecordId");

            migrationBuilder.AddForeignKey(
                name: "FK_RedistributionRequests_ExcessWasteRecords_SourceExcessWasteR~",
                table: "RedistributionRequests",
                column: "SourceExcessWasteRecordId",
                principalTable: "ExcessWasteRecords",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RedistributionRequests_ExcessWasteRecords_SourceExcessWasteR~",
                table: "RedistributionRequests");

            migrationBuilder.DropIndex(
                name: "IX_RedistributionRequests_SourceExcessWasteRecordId",
                table: "RedistributionRequests");

            migrationBuilder.DropColumn(
                name: "SourceExcessWasteRecordId",
                table: "RedistributionRequests");
        }
    }
}
