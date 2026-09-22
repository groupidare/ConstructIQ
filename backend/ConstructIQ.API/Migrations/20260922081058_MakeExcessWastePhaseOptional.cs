using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class MakeExcessWastePhaseOptional : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ExcessWasteRecords_Phases_PhaseId",
                table: "ExcessWasteRecords");

            migrationBuilder.AlterColumn<int>(
                name: "PhaseId",
                table: "ExcessWasteRecords",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddForeignKey(
                name: "FK_ExcessWasteRecords_Phases_PhaseId",
                table: "ExcessWasteRecords",
                column: "PhaseId",
                principalTable: "Phases",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ExcessWasteRecords_Phases_PhaseId",
                table: "ExcessWasteRecords");

            migrationBuilder.AlterColumn<int>(
                name: "PhaseId",
                table: "ExcessWasteRecords",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ExcessWasteRecords_Phases_PhaseId",
                table: "ExcessWasteRecords",
                column: "PhaseId",
                principalTable: "Phases",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
