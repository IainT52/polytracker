"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const migrator_1 = require("drizzle-orm/libsql/migrator");
const index_1 = require("./index");
async function main() {
    console.log("Running Drizzle Migrations...");
    try {
        await (0, migrator_1.migrate)(index_1.db, { migrationsFolder: "./drizzle" });
        console.log("Migrations complete!");
    }
    catch (error) {
        console.error("Migration failed:", error);
    }
    process.exit(0);
}
main();
