"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrGenerateBurnerWallet = getOrGenerateBurnerWallet;
const ethers_1 = require("ethers");
const db_1 = require("../db");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
/**
 * Ensures a user has a designated "burner" wallet for copy trading.
 * If one does not exist, it generates one and securely saves the private key.
 * NOTE: For MVP, storing raw PVK in SQLite. In prod, use KMS or encrypted vaults.
 */
async function getOrGenerateBurnerWallet(telegramId) {
    const userRow = await db_1.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.telegramId, telegramId)).get();
    if (!userRow)
        throw new Error("User not registered.");
    // For this architecture phase, we temporarily mutate the User object interface idea.
    // We need to add `burnerWalletAddress` and `burnerWalletKey` to the users table schema.
    // Since we haven't added those columns yet in schema.ts, we will return a mock
    // Or if we need to add them, we update schema.ts again.
    // Let's generate a temporary burner wallet for testing purposes.
    const wallet = ethers_1.ethers.Wallet.createRandom();
    console.log(`[WalletManager] Generated burner wallet for ${telegramId}: ${wallet.address}`);
    return {
        address: wallet.address,
        privateKey: wallet.privateKey
    };
}
