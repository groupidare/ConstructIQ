using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ConstructIQ.API.Migrations
{
    /// <inheritdoc />
    public partial class FixOrphanedLastLoginMigration : Migration
    {
        // The original 20260620130000_AddPhoneNumberLastLogin migration was applied to
        // existing databases (its Up() added these columns) but its Designer.cs was never
        // committed, so EF's migration tooling never recognized it — `dotnet ef migrations
        // list`/`database update` silently skip it, leaving any freshly-created database
        // (new environment, CI, the security-checks integration suite) without these
        // columns. Re-adding them here, guarded by an existence check, fixes new databases
        // without re-running DDL against databases that already have the columns.
        private const string AddColumnIfMissingSql = @"
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = '{0}');
SET @ddl = IF(@col_exists = 0, '{1}', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;";

        private const string DropColumnIfPresentSql = @"
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = '{0}');
SET @ddl = IF(@col_exists > 0, 'ALTER TABLE `Users` DROP COLUMN `{0}`', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(string.Format(AddColumnIfMissingSql, "PhoneNumber",
                "ALTER TABLE `Users` ADD COLUMN `PhoneNumber` varchar(30) CHARACTER SET utf8mb4 NULL"));
            migrationBuilder.Sql(string.Format(AddColumnIfMissingSql, "LastLogin",
                "ALTER TABLE `Users` ADD COLUMN `LastLogin` datetime(6) NULL"));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(string.Format(DropColumnIfPresentSql, "LastLogin"));
            migrationBuilder.Sql(string.Format(DropColumnIfPresentSql, "PhoneNumber"));
        }
    }
}
