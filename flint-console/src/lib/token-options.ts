export type TokenOption = {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
};

export const TOKEN_OPTIONS: TokenOption[] = [
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

export function tokenChoices() {
  return TOKEN_OPTIONS;
}

export function tokenByMint(mint: string) {
  return TOKEN_OPTIONS.find((token) => token.mint === mint) ?? null;
}
