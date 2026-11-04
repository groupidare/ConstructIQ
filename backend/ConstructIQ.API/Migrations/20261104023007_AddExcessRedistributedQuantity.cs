using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddExcessRedistributedQuantity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "RedistributedQuantity",
                table: "ExcessWasteRecords",
                type: "decimal(18,4)",
                nullable: false,
                defaultValue: 0m);

            // Approved transfers already came off Quantity; record them so those
            // entries show what was logged again. 2, 3, 4 = Approved, InTransit, Completed.
            migrationBuilder.Sql(@"
                UPDATE ExcessWasteRecords e
                SET RedistributedQuantity = COALESCE((SELECT SUM(r.Quantity) FROM RedistributionRequests r
                    WHERE r.SourceExcessWasteRecordId = e.Id AND r.Status IN (2, 3, 4)), 0);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RedistributedQuantity",
                table: "ExcessWasteRecords");
        }
    }
}
