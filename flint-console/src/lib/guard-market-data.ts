import type { PoolSnapshot } from "./guard-types";

export async function fetchPoolSnapshots(ammKeys: string[]) {
  const uniqueKeys = Array.from(new Set(ammKeys.filter(Boolean)));
  const snapshots = await Promise.all(uniqueKeys.map((ammKey) => fetchPoolSnapshot(ammKey)));
  return snapshots.reduce<Record<string, PoolSnapshot>>((acc, snapshot) => {
    if (snapshot) {
      acc[snapshot.ammKey] = snapshot;
    }
    return acc;
  }, {});
}

async function fetchPoolSnapshot(ammKey: string) {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${ammKey}`);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      pairs?: Array<{
        dexId?: string;
        url?: string;
        liquidity?: { usd?: number };
        pairCreatedAt?: number;
        priceChange?: { h1?: number; m5?: number };
        txns?: { m5?: { buys?: number; sells?: number } };
      }>;
    };
    const pair = payload.pairs && payload.pairs[0];
    if (!pair) {
      return null;
    }

    const snapshot: PoolSnapshot = {
      ammKey: ammKey,
      dexId: pair.dexId ?? null,
      liquidityUsd:
        pair.liquidity && typeof pair.liquidity.usd === "number" ? pair.liquidity.usd : null,
      pairCreatedAt:
        typeof pair.pairCreatedAt === "number" ? pair.pairCreatedAt : null,
      priceChangeH1:
        pair.priceChange && typeof pair.priceChange.h1 === "number" ? pair.priceChange.h1 : null,
      priceChangeM5:
        pair.priceChange && typeof pair.priceChange.m5 === "number" ? pair.priceChange.m5 : null,
      buysM5:
        pair.txns && pair.txns.m5 && typeof pair.txns.m5.buys === "number"
          ? pair.txns.m5.buys
          : null,
      sellsM5:
        pair.txns && pair.txns.m5 && typeof pair.txns.m5.sells === "number"
          ? pair.txns.m5.sells
          : null,
      url: pair.url ?? null,
    };

    return snapshot;
  } catch {
    return null;
  }
}
