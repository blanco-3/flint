export type TokenOption = {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
};

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

const BASE_TOKEN_OPTIONS: TokenOption[] = [
  {
    symbol: "SOL",
    name: "Solana",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  },
  {
    symbol: "JUP",
    name: "Jupiter",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    decimals: 6,
  },
  {
    symbol: "BONK",
    name: "Bonk",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6Xc5x6sJvtJ6a8wX",
    decimals: 5,
  },
  {
    symbol: "mSOL",
    name: "Marinade staked SOL",
    mint: "mSoLzYCxHdYgdzUuP9nD2p7xU7eD7LZf8hTz7f7d92x",
    decimals: 9,
  },
  {
    symbol: "jitoSOL",
    name: "Jito Staked SOL",
    mint: "J1toso1uCXnS7FZLkJ6BxVQxzLhcM1YMe73PvvrQ4ep",
    decimals: 9,
  },
];

export const TOKEN_OPTIONS = BASE_TOKEN_OPTIONS;

const tokenRegistry = new Map<string, TokenOption>(
  BASE_TOKEN_OPTIONS.map((token) => [token.mint, token])
);

export function tokenChoices() {
  return [...tokenRegistry.values()].sort((left, right) => {
    const leftBase = Number(BASE_TOKEN_OPTIONS.some((token) => token.mint === left.mint));
    const rightBase = Number(BASE_TOKEN_OPTIONS.some((token) => token.mint === right.mint));
    if (leftBase !== rightBase) return rightBase - leftBase;
    return left.symbol.localeCompare(right.symbol);
  });
}

export function tokenByMint(mint: string) {
  return tokenRegistry.get(mint) ?? null;
}

export function registerTokenOptions(tokens: TokenOption[]) {
  let changed = false;
  for (const token of tokens) {
    if (!token.mint || !token.symbol) continue;
    const next = normalizeTokenOption(token);
    const existing = tokenRegistry.get(next.mint);
    if (!existing || hasMeaningfulTokenDiff(existing, next)) {
      tokenRegistry.set(next.mint, existing ? mergeTokenOption(existing, next) : next);
      changed = true;
    }
  }
  return changed;
}

export async function searchDexTokenOptions(query: string) {
  const normalized = query.trim();
  if (normalized.length < 2) return [];

  const response = await fetch(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(normalized)}`
  );
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    pairs?: Array<{
      chainId?: string;
      baseToken?: { address?: string; symbol?: string; name?: string };
      quoteToken?: { address?: string; symbol?: string; name?: string };
    }>;
  };

  const discovered = dedupeByMint(
    (payload.pairs ?? [])
      .filter((pair) => pair.chainId === "solana")
      .flatMap((pair) => [
        toTokenOption(pair.baseToken),
        toTokenOption(pair.quoteToken),
      ])
      .filter((token): token is TokenOption => Boolean(token))
  );

  registerTokenOptions(discovered);
  return discovered;
}

export async function hydrateTokenOption(mint: string) {
  const existing = tokenByMint(mint);
  if (!existing) return null;

  const metadata = await fetchMintMetadata(mint).catch(() => null);
  if (!metadata) {
    return existing;
  }

  const next = mergeTokenOption(existing, {
    ...existing,
    decimals: metadata.decimals,
    symbol: metadata.symbol ?? existing.symbol,
    name: metadata.name ?? existing.name,
  });
  tokenRegistry.set(mint, next);
  return next;
}

async function fetchMintMetadata(mint: string) {
  const response = await fetch(MAINNET_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: mint,
      method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }],
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    result?: {
      value?: {
        data?: {
          parsed?: {
            info?: {
              decimals?: number;
              symbol?: string;
              name?: string;
            };
          };
        };
      };
    };
  };
  const info = payload.result?.value?.data?.parsed?.info;
  if (!info || typeof info.decimals !== "number") {
    return null;
  }
  return {
    decimals: info.decimals,
    symbol: typeof info.symbol === "string" ? info.symbol : null,
    name: typeof info.name === "string" ? info.name : null,
  };
}

function toTokenOption(
  token:
    | {
        address?: string;
        symbol?: string;
        name?: string;
      }
    | undefined
) {
  if (!token?.address || !token.symbol) return null;
  return normalizeTokenOption({
    mint: token.address,
    symbol: token.symbol,
    name: token.name ?? token.symbol,
    decimals: tokenByMint(token.address)?.decimals ?? 6,
  });
}

function normalizeTokenOption(token: TokenOption) {
  return {
    mint: token.mint,
    symbol: token.symbol.trim(),
    name: token.name.trim(),
    decimals: token.decimals,
  };
}

function mergeTokenOption(existing: TokenOption, next: TokenOption) {
  return {
    mint: existing.mint,
    symbol: next.symbol || existing.symbol,
    name: next.name || existing.name,
    decimals: next.decimals ?? existing.decimals,
  };
}

function dedupeByMint(tokens: TokenOption[]) {
  const seen = new Map<string, TokenOption>();
  for (const token of tokens) {
    const existing = seen.get(token.mint);
    seen.set(token.mint, existing ? mergeTokenOption(existing, token) : token);
  }
  return [...seen.values()];
}

function hasMeaningfulTokenDiff(left: TokenOption, right: TokenOption) {
  return (
    left.symbol !== right.symbol ||
    left.name !== right.name ||
    left.decimals !== right.decimals
  );
}
