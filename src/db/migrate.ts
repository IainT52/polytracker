import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./index";

async function main() {
  console.log("Running Drizzle Migrations...");
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Migrations complete!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
  process.exit(0);
}

main();
