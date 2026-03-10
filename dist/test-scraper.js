"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const historicalScraper_1 = require("./services/historicalScraper");
const db_1 = require("./db");
const schema_1 = require("./db/schema");
const drizzle_orm_1 = require("drizzle-orm");
async function main() {
    console.log("Starting scrape...");
    await (0, historicalScraper_1.scrapeHistoricalData)();
    console.log("Scrape finished! Checking DB...");
    const w = await db_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` }).from(schema_1.wallets).get();
    const t = await db_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` }).from(schema_1.trades).get();
    const m = await db_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` }).from(schema_1.markets).get();
    console.log(`DB Count -> Markets: ${m?.count}, Wallets: ${w?.count}, Trades: ${t?.count}`);
    process.exit(0);
}
main().catch(console.error);
