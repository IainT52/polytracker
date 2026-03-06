import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import * as dotenv from 'dotenv';
dotenv.config();

export const client = createClient({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});

export const db = drizzle(client, { schema });
