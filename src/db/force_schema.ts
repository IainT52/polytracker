import { db } from "./index";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Forcing Phase 16 SQLite Schema additions...");
  try {
    const queries = [
      `ALTER TABLE wallets ADD COLUMN total_trades INTEGER;`,
      `ALTER TABLE wallets ADD COLUMN total_volume REAL;`,
      `ALTER TABLE wallets ADD COLUMN realized_pnl REAL;`,
      `ALTER TABLE markets ADD COLUMN volume REAL;`,
      `ALTER TABLE markets ADD COLUMN end_date TEXT;`,
      `ALTER TABLE markets ADD COLUMN icon TEXT;`
    ];

    for (const q of queries) {
      try {
        await db.run(sql.raw(q));
        console.log(`Executed: ${q}`);
      } catch (e: any) {
        if (e.message.includes("duplicate column name")) {
          console.log(`Skipped existing column setup: ${q}`);
        } else {
          console.error(`Error on ${q}:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error("Fatal Error:", err);
  }
}
main();
