using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddExcessWasteBOQItemLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BOQItemId",
                table: "ExcessWasteRecords",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExcessWasteRecords_BOQItemId",
                table: "ExcessWasteRecords",
                column: "BOQItemId");

            migrationBuilder.AddForeignKey(
                name: "FK_ExcessWasteRecords_BOQItems_BOQItemId",
                table: "ExcessWasteRecords",
                column: "BOQItemId",
                principalTable: "BOQItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ExcessWasteRecords_BOQItems_BOQItemId",
                table: "ExcessWasteRecords");

            migrationBuilder.DropIndex(
                name: "IX_ExcessWasteRecords_BOQItemId",
                table: "ExcessWasteRecords");

            migrationBuilder.DropColumn(
                name: "BOQItemId",
                table: "ExcessWasteRecords");
        }
    }
}
