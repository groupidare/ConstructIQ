using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class AddDeliveryDocumentTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PoFileUrl",
                table: "PurchaseOrders",
                type: "varchar(255)",
                maxLength: 255,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            // Every row saved before this column existed is a real
            // proof-of-delivery photo (that was the only thing a batch could
            // hold back then) — defaultValue 1 = DeliveryDocumentType.
            // ProofOfDelivery, NOT the enum's own CLR default of 0
            // (DeliveryReceipt), which would otherwise mislabel every
            // existing photo on backfill.
            migrationBuilder.AddColumn<int>(
                name: "DocumentType",
                table: "DeliveryBatchPhotos",
                type: "int",
                nullable: false,
                defaultValue: 1);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PoFileUrl",
                table: "PurchaseOrders");

            migrationBuilder.DropColumn(
                name: "DocumentType",
                table: "DeliveryBatchPhotos");
        }
    }
}
