import { db, setupDbSync } from '../db';
import { wallets, walletCorrelations } from '../db/schema';

async function seed() {
  const mockWallets = [
    { address: '0xAAA1111111111111111111111111111111111111', grade: 'A', recentRoi30d: 45.2, winRate: 68.5, isBot: false },
    { address: '0xAAA2222222222222222222222222222222222222', grade: 'A', recentRoi30d: 32.1, winRate: 61.2, isBot: false },
    { address: '0xAAA3333333333333333333333333333333333333', grade: 'A', recentRoi30d: 88.9, winRate: 75.0, isBot: false },
    { address: '0xBBB1111111111111111111111111111111111111', grade: 'B', recentRoi30d: 12.4, winRate: 52.1, isBot: false },
    { address: '0xBBB2222222222222222222222222222222222222', grade: 'B', recentRoi30d: 8.5, winRate: 55.0, isBot: false },
    { address: '0xBBB3333333333333333333333333333333333333', grade: 'B', recentRoi30d: 15.2, winRate: 58.4, isBot: false },
  ];

  for (const w of mockWallets) {
    try {
      await db.insert(wallets).values(w).onConflictDoNothing();
      console.log('Inserted mock wallet:', w.address);
    } catch (e) {
      console.error(e);
    }
  }

  const mockSyndicates = [
    { walletA: '0xAAA1111111111111111111111111111111111111', walletB: '0xAAA2222222222222222222222222222222222222', coOccurrenceCount: 15, lastSeenTogether: new Date() },
    { walletA: '0xAAA1111111111111111111111111111111111111', walletB: '0xAAA3333333333333333333333333333333333333', coOccurrenceCount: 8, lastSeenTogether: new Date() },
    { walletA: '0xAAA2222222222222222222222222222222222222', walletB: '0xAAA3333333333333333333333333333333333333', coOccurrenceCount: 12, lastSeenTogether: new Date() },
    
    { walletA: '0xBBB1111111111111111111111111111111111111', walletB: '0xBBB2222222222222222222222222222222222222', coOccurrenceCount: 5, lastSeenTogether: new Date() },
    { walletA: '0xBBB2222222222222222222222222222222222222', walletB: '0xBBB3333333333333333333333333333333333333', coOccurrenceCount: 7, lastSeenTogether: new Date() },
    
    // Cross grade correlation
    { walletA: '0xAAA3333333333333333333333333333333333333', walletB: '0xBBB1111111111111111111111111111111111111', coOccurrenceCount: 4, lastSeenTogether: new Date() },
  ];

  for (const s of mockSyndicates) {
    try {
      await db.insert(walletCorrelations).values(s).onConflictDoNothing();
      console.log('Inserted mock correlation');
    } catch (e) {
      console.error(e);
    }
  }
}
setupDbSync().then(() => {
  seed().then(() => process.exit(0)).catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}).catch(err => {
  console.error('DB setup failed:', err);
  process.exit(1);
});
