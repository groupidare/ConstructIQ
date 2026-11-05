using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <summary>
    /// Data only: PO lines generated from material requests before
    /// GeneratePOs copied the request's Material Plan row get that row now.
    /// A line is linked only when every request for its material on that PO
    /// points to the same row, so nothing ambiguous is guessed; a line
    /// someone already linked by hand is left as it is.
    /// </summary>
    public partial class LinkGeneratedPoLinesToBoqRows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
UPDATE PurchaseOrderMaterials m
JOIN (
    SELECT FulfilledByPurchaseOrderId AS PoId, MaterialId, MIN(BOQItemId) AS BoqId
    FROM MaterialRequests
    WHERE FulfilledByPurchaseOrderId IS NOT NULL AND BOQItemId IS NOT NULL
    GROUP BY FulfilledByPurchaseOrderId, MaterialId
    HAVING COUNT(DISTINCT BOQItemId) = 1
) r ON r.PoId = m.PurchaseOrderId AND r.MaterialId = m.MaterialId
SET m.BOQItemId = r.BoqId
WHERE m.BOQItemId IS NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Data fix — the links stay; they're what GeneratePOs sets now anyway.
        }
    }
}
