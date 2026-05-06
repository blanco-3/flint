import type { DexMarketPair, PoolSnapshot } from "./guard-types";

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

export async function fetchLiveMarketPairs(tokenMints: string[], limit = 12) {
  const responses = await Promise.all(tokenMints.map((mint) => fetchTokenPairs(mint)));
  const seen = new Map<string, DexMarketPair>();

  for (const pairs of responses) {
    for (const pair of pairs) {
      if (!seen.has(pair.pairAddress)) {
        seen.set(pair.pairAddress, pair);
      }
    }
  }

  return [...seen.values()]
    .sort((left, right) => {
      const liqDiff = (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0);
      if (liqDiff !== 0) return liqDiff;
      return Math.abs(right.priceChangeH1 ?? 0) - Math.abs(left.priceChangeH1 ?? 0);
    })
    .slice(0, limit);
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

async function fetchTokenPairs(mint: string) {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as {
      pairs?: Array<{
        chainId?: string;
        dexId?: string;
        url?: string;
        pairAddress?: string;
        liquidity?: { usd?: number };
        pairCreatedAt?: number;
        priceChange?: { h1?: number; m5?: number };
        txns?: { m5?: { buys?: number; sells?: number } };
        baseToken?: { address?: string; symbol?: string; name?: string };
        quoteToken?: { address?: string; symbol?: string; name?: string };
      }>;
    };
    return (payload.pairs ?? [])
      .filter((pair) => pair.chainId === "solana")
      .map((pair) => ({
        pairAddress: pair.pairAddress ?? "",
        dexId: pair.dexId ?? null,
        url: pair.url ?? null,
        liquidityUsd:
          pair.liquidity && typeof pair.liquidity.usd === "number" ? pair.liquidity.usd : null,
        pairCreatedAt: typeof pair.pairCreatedAt === "number" ? pair.pairCreatedAt : null,
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
        baseToken: {
          address: pair.baseToken?.address ?? "",
          symbol: pair.baseToken?.symbol ?? "unknown",
          name: pair.baseToken?.name ?? "Unknown token",
        },
        quoteToken: {
          address: pair.quoteToken?.address ?? "",
          symbol: pair.quoteToken?.symbol ?? "unknown",
          name: pair.quoteToken?.name ?? "Unknown token",
        },
      }))
      .filter((pair) => Boolean(pair.pairAddress) && Boolean(pair.baseToken.address) && Boolean(pair.quoteToken.address));
  } catch {
    return [];
  }
}
