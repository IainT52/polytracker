"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const schema_1 = require("./db/schema");
const drizzle_orm_1 = require("drizzle-orm");
async function main() {
    console.log('Testing Database Connection with Drizzle...');
    // Create a User
    const [user] = await db_1.db.insert(schema_1.users).values({
        telegramId: `test-${Date.now()}`,
        username: 'TestUser',
        alertsEnabled: true,
        paperTrading: true,
    }).returning();
    console.log('Created User:', user);
    // Create a Wallet
    const [wallet] = await db_1.db.insert(schema_1.wallets).values({
        address: `0x${Math.random().toString(16).substring(2, 42)}`,
        grade: 'A',
        roi: 12.5,
        winRate: 85.0,
        isBot: false,
    }).returning();
    console.log('Created Wallet:', wallet);
    // Read the User
    const foundUser = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id)).get();
    console.log('Found User:', foundUser);
    // Clean up
    await db_1.db.delete(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, user.id));
    await db_1.db.delete(schema_1.wallets).where((0, drizzle_orm_1.eq)(schema_1.wallets.id, wallet.id));
    console.log('Database Test Successful! Cleaned up test data.');
}
main()
    .catch((e) => {
    console.error('Error testing database:', e);
    process.exit(1);
});
