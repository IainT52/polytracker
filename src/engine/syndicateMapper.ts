import { db } from '../db';
import { sql } from 'drizzle-orm';
import { syndicates, syndicateMembers } from '../db/schema';

export async function mapSyndicates() {
  console.log('[SyndicateMapper] Starting N-Size Syndicate Graph Clustering...');
  const startTime = Date.now();

  try {
    // Step A: Fetch "Smart" trades
    const rawTrades = await db.all(sql`
      SELECT 
        t.wallet_id,
        t.market_id,
        t.outcome_index,
        t.timestamp,
        m.question,
        m.volume,
        w.realized_pnl as w_pnl,
        w.win_rate as w_winrate
      FROM trades t
      INNER JOIN wallets w ON t.wallet_id = w.address AND w.grade IN ('A', 'B')
      INNER JOIN markets m ON t.market_id = m.id
      WHERE t.action = 'BUY'
      ORDER BY t.market_id, t.outcome_index, t.timestamp ASC
    `);

    // Grouping by tight time window (2 hours = 7200000ms)
    const groups: string[][] = [];
    let currentWindow: any[] = [];

    for (let i = 0; i < rawTrades.length; i++) {
      const trade: any = rawTrades[i];
      if (currentWindow.length === 0) {
        currentWindow.push(trade);
        continue;
      }

      const firstInWindow = currentWindow[0];
      const sameMarket = trade.market_id === firstInWindow.market_id && trade.outcome_index === firstInWindow.outcome_index;
      const withinTime = (trade.timestamp - firstInWindow.timestamp) <= 7200000;

      if (sameMarket && withinTime) {
        currentWindow.push(trade);
      } else {
        const walletsInWindow = Array.from(new Set(currentWindow.map(t => t.wallet_id)));
        if (walletsInWindow.length > 1) {
          groups.push(walletsInWindow);
        }
        currentWindow = [trade];
      }
    }
    if (currentWindow.length > 1) {
      groups.push(Array.from(new Set(currentWindow.map(t => t.wallet_id))));
    }

    // Step B: Build Weighted Adjacency List
    const graph = new Map<string, Map<string, number>>();
    const addEdge = (w1: string, w2: string) => {
      if (!graph.has(w1)) graph.set(w1, new Map());
      if (!graph.has(w2)) graph.set(w2, new Map());

      const m1 = graph.get(w1)!;
      m1.set(w2, (m1.get(w2) || 0) + 1);

      const m2 = graph.get(w2)!;
      m2.set(w1, (m2.get(w1) || 0) + 1);
    };

    for (const group of groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          addEdge(group[i], group[j]);
        }
      }
    }

    // Step C: Filter weak edges (weight >= 3) and connected components
    const MIN_WEIGHT = 3;
    const visited = new Set<string>();
    const clusters: string[][] = [];

    const getNeighbors = (node: string) => {
      const neighbors: string[] = [];
      const edges = graph.get(node);
      if (edges) {
        for (const [neighbor, weight] of edges.entries()) {
          if (weight >= MIN_WEIGHT) {
            neighbors.push(neighbor);
          }
        }
      }
      return neighbors;
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        const cluster: string[] = [];
        const queue = [node];
        visited.add(node);

        while (queue.length > 0) {
          const current = queue.shift()!;
          cluster.push(current);

          for (const neighbor of getNeighbors(current)) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }

        if (cluster.length >= 2) {
          clusters.push(cluster);
        }
      }
    }

    console.log(`[SyndicateMapper] Found ${clusters.length} syndicates.`);

    // Step D: Profiling and DB Insertion
    await db.delete(syndicateMembers);
    await db.delete(syndicates);

    let clusterId = 1;
    for (const cluster of clusters) {
      const clusterSet = new Set(cluster);
      const clusterTrades = rawTrades.filter(t => clusterSet.has((t as any).wallet_id));

      let totalVolume = 0;
      const marketQuestions = new Set<string>();
      const marketIds = new Set<number>();

      // Compute combined Wallet PnL and Avg Winrate
      const uniqueWallets = new Map<string, { pnl: number, wr: number }>();

      for (const t of clusterTrades) {
        const tAny = t as any;
        if (!uniqueWallets.has(tAny.wallet_id)) {
          uniqueWallets.set(tAny.wallet_id, {
            pnl: tAny.w_pnl || 0,
            wr: tAny.w_winrate || 0
          });
        }
        if (!marketIds.has(tAny.market_id)) {
          marketIds.add(tAny.market_id);
          if (tAny.volume !== null && tAny.volume !== undefined) {
            totalVolume += tAny.volume;
          }
          if (tAny.question) {
            marketQuestions.add(tAny.question);
          }
        }
      }

      let totalPnL = 0;
      let totalWinRate = 0;
      for (const val of uniqueWallets.values()) {
        totalPnL += val.pnl;
        totalWinRate += val.wr;
      }

      const winRate = uniqueWallets.size > 0 ? (totalWinRate / uniqueWallets.size) : 0;
      const avgVolume = marketIds.size > 0 ? (totalVolume / marketIds.size) : 0;

      const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'will', 'is', 'be', 'by', 'at', 'this', 'that', 'from', 'with']);
      const wordCounts = new Map<string, number>();

      for (const q of marketQuestions) {
        const words = q.replace(/[^a-zA-Z0-9\s]/g, '').toLowerCase().split(/\s+/);
        for (const w of words) {
          if (w.length > 2 && !stopWords.has(w)) {
            wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
          }
        }
      }

      const topKeywords = Array.from(wordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(e => e[0].charAt(0).toUpperCase() + e[0].slice(1))
        .join(', ');

      const name = `Syndicate #${clusterId++}`;

      const result = await db.insert(syndicates).values({
        name,
        size: cluster.length,
        combinedPnL: parseFloat(totalPnL.toFixed(2)),
        winRate: parseFloat(winRate.toFixed(1)),
        targetVolumeLevel: parseFloat(avgVolume.toFixed(2)),
        topKeywords: topKeywords || 'Uncategorized'
      }).returning({ id: syndicates.id });

      const insertedId = result[0].id;

      const memberRows = cluster.map(wallet => ({
        syndicateId: insertedId,
        walletAddress: wallet
      }));

      await db.insert(syndicateMembers).values(memberRows);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[SyndicateMapper] Processing complete in ${elapsed}ms.`);

  } catch (error) {
    console.error('[SyndicateMapper] Error mapping syndicates:', error);
  }
}

// Allow running directly
if (require.main === module) {
  mapSyndicates().then(() => {
    console.log('Done.');
    process.exit(0);
  });
}
