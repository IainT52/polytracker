import { db } from '../db';
import { walletCorrelations } from '../db/schema';

async function seed() {
  const mockSyndicates = [
    { walletA: '0x1111111111111111111111111111111111111111', walletB: '0x2222222222222222222222222222222222222222', coOccurrenceCount: 15, lastSeenTogether: new Date() },
    { walletA: '0x1111111111111111111111111111111111111111', walletB: '0x3333333333333333333333333333333333333333', coOccurrenceCount: 8, lastSeenTogether: new Date() },
    { walletA: '0x2222222222222222222222222222222222222222', walletB: '0x3333333333333333333333333333333333333333', coOccurrenceCount: 10, lastSeenTogether: new Date() },
    { walletA: '0x4444444444444444444444444444444444444444', walletB: '0x5555555555555555555555555555555555555555', coOccurrenceCount: 5, lastSeenTogether: new Date() },
    { walletA: '0x4444444444444444444444444444444444444444', walletB: '0x6666666666666666666666666666666666666666', coOccurrenceCount: 7, lastSeenTogether: new Date() },
    { walletA: '0x5555555555555555555555555555555555555555', walletB: '0x6666666666666666666666666666666666666666', coOccurrenceCount: 22, lastSeenTogether: new Date() },
    { walletA: '0x3333333333333333333333333333333333333333', walletB: '0x4444444444444444444444444444444444444444', coOccurrenceCount: 3, lastSeenTogether: new Date() },
  ];

  for (const s of mockSyndicates) {
    try {
      await db.insert(walletCorrelations).values(s).onConflictDoNothing();
      console.log('Inserted');
    } catch (e) {
      console.error(e);
    }
  }
}
seed().then(() => process.exit(0));
