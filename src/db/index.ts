import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import * as dotenv from 'dotenv';
dotenv.config();

export const client = createClient({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});

// Phase 13: Enable Write-Ahead Logging to prevent SQLITE_BUSY locked DB errors
// This allows simultaneous read/writes between the Scraper and the API/Frontend
export async function setupDbSync() {
  await client.execute('PRAGMA journal_mode = WAL;');
  await client.execute('PRAGMA busy_timeout = 5000;');
}

export const db = drizzle(client, { schema });
