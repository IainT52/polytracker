import { client } from './src/db/index';

async function patch() {
  try {
    await client.execute('ALTER TABLE "markets" ADD COLUMN "alpha_signal_fired" integer DEFAULT 0');
    console.log("Column added safely.");
  } catch (e: any) {
    if (e.message.includes("duplicate column name")) {
      console.log("Column already exists. Continuing...");
    } else {
      console.error(e);
    }
  }
}
patch().then(() => process.exit(0));
