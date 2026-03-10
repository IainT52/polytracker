import { db } from './src/db';
import { users } from './src/db/schema';
import { eq } from 'drizzle-orm';

async function test() {
  console.log('Testing DB connection...');
  try {
    let user = await db.select().from(users).where(eq(users.telegramId, '12345')).get();
    console.log('Query finished. User:', user);
  } catch (e) {
    console.error('Error:', e);
  }
  process.exit(0);
}
test();
