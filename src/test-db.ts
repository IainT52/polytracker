import { db } from './db';
import { users, wallets } from './db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  console.log('Testing Database Connection with Drizzle...');

  // Create a User
  const [user] = await db.insert(users).values({
    telegramId: `test-${Date.now()}`,
    username: 'TestUser',
    alertsEnabled: true,
    paperTrading: true,
  }).returning();

  console.log('Created User:', user);

  // Create a Wallet
  const [wallet] = await db.insert(wallets).values({
    address: `0x${Math.random().toString(16).substring(2, 42)}`,
    grade: 'A',
    roi: 12.5,
    winRate: 85.0,
    isBot: false,
  }).returning();

  console.log('Created Wallet:', wallet);

  // Read the User
  const foundUser = await db.select().from(users).where(eq(users.id, user.id)).get();
  console.log('Found User:', foundUser);

  // Clean up
  await db.delete(users).where(eq(users.id, user.id));
  await db.delete(wallets).where(eq(wallets.id, wallet.id));

  console.log('Database Test Successful! Cleaned up test data.');
}

main()
  .catch((e) => {
    console.error('Error testing database:', e);
    process.exit(1);
  });
