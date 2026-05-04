import { POLICY_PRESETS } from "./guard-policies";
import { evaluateQuoteRisk } from "./guard-risk";
import type {
  DemoScenario,
  DemoScenarioId,
  PoolSnapshot,
  JupiterQuote,
  QuoteComparison,
  RiskPolicy,
  TriggerOrder,
} from "./guard-types";
import { TOKEN_OPTIONS } from "./token-options";

const SOL = TOKEN_OPTIONS[0].mint;
const USDC = TOKEN_OPTIONS[1].mint;
const JUP = TOKEN_OPTIONS[2].mint;
const BONK = TOKEN_OPTIONS[3].mint;

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "fresh-pool-rug",
    label: "Fresh pool rug",
    summary: "New pool, thin liquidity, and heavy sell pressure force Flint to reject the best-price route.",
    form: {
      inputMint: SOL,
      outputMint: BONK,
      amount: "1",
      slippageBps: 100,
    },
    signals: {
      tokens: [],
      pairs: [],
      venues: ["pumpswap"],
    },
  },
  {
    id: "venue-panic",
    label: "Venue panic",
    summary: "A venue is manually flagged during an ecosystem incident and Flint reroutes away from it.",
    form: {
      inputMint: JUP,
      outputMint: SOL,
      amount: "250",
      slippageBps: 75,
    },
    signals: {
      tokens: [],
      pairs: [],
      venues: ["zerofi"],
    },
  },
  {
    id: "unknown-metadata",
    label: "Unknown venue metadata",
    summary: "Treasury mode fails closed when the best route lacks enough pool metadata to trust.",
    form: {
      inputMint: SOL,
      outputMint: USDC,
      amount: "5",
      slippageBps: 50,
    },
    signals: {
      tokens: [],
      pairs: [],
      venues: [],
    },
  },
];

export function demoScenarioById(id: DemoScenarioId) {
  return DEMO_SCENARIOS.find((item) => item.id === id) ?? DEMO_SCENARIOS[0];
}

export function buildDemoComparison(
  scenarioId: DemoScenarioId,
  policy: RiskPolicy,
  safeMode: boolean
): QuoteComparison {
  const fixture = DEMO_FIXTURES[scenarioId];
  const baseAssessment = evaluateQuoteRisk(fixture.baseQuote, fixture.basePools, policy);
  const safeAssessment = fixture.safeQuote
    ? evaluateQuoteRisk(fixture.safeQuote, fixture.safePools, policy)
    : null;

  let executionTarget: "base" | "safe" | "none" = "base";
  if (safeMode && baseAssessment.status === "blocked") {
    executionTarget = safeAssessment && safeAssessment.status !== "blocked" ? "safe" : "none";
  } else if (safeAssessment && safeMode && safeAssessment.status !== "blocked") {
    executionTarget = "safe";
  }

  return {
    baseQuote: fixture.baseQuote,
    baseAssessment: baseAssessment,
    safeQuote: fixture.safeQuote,
    safeAssessment: safeAssessment,
    blockedVenuesUsed: baseAssessment.blockedVenues,
    safeMode: safeMode,
    executionTarget: executionTarget,
  };
}

export function getDemoOrders(scenarioId: DemoScenarioId): TriggerOrder[] {
  return DEMO_FIXTURES[scenarioId].orders.map((order) => ({ ...order }));
}

export function recommendedDemoPresetForScenario(id: DemoScenarioId) {
  if (id === "unknown-metadata") {
    return POLICY_PRESETS.treasury.id;
  }
  return POLICY_PRESETS.retail.id;
}

const DEMO_FIXTURES: Record<
  DemoScenarioId,
  {
    baseQuote: JupiterQuote;
    safeQuote: JupiterQuote;
    basePools: Record<string, PoolSnapshot>;
    safePools: Record<string, PoolSnapshot>;
    orders: TriggerOrder[];
  }
> = {
  "fresh-pool-rug": {
    baseQuote: {
      inputMint: SOL,
      inAmount: "1000000000",
      outputMint: BONK,
      outAmount: "244000000",
      otherAmountThreshold: "240000000",
      swapMode: "ExactIn",
      slippageBps: 100,
      priceImpactPct: "0.91",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "demo-pump-amm",
            inputMint: SOL,
            outputMint: BONK,
            inAmount: "1000000000",
            outAmount: "244000000",
            feeAmount: "180000",
            feeMint: SOL,
            label: "PumpSwap",
          },
        },
      ],
    },
    safeQuote: {
      inputMint: SOL,
      inAmount: "1000000000",
      outputMint: BONK,
      outAmount: "232000000",
      otherAmountThreshold: "229000000",
      swapMode: "ExactIn",
      slippageBps: 100,
      priceImpactPct: "0.44",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "demo-ray-amm",
            inputMint: SOL,
            outputMint: BONK,
            inAmount: "1000000000",
            outAmount: "232000000",
            feeAmount: "120000",
            feeMint: SOL,
            label: "Raydium CLMM",
          },
        },
      ],
    },
    basePools: {
      "demo-pump-amm": {
        ammKey: "demo-pump-amm",
        dexId: "pumpswap",
        liquidityUsd: 18_500,
        pairCreatedAt: Date.now() - 90 * 60_000,
        priceChangeH1: -34,
        priceChangeM5: -8,
        buysM5: 2,
        sellsM5: 12,
        url: null,
      },
    } as Record<string, PoolSnapshot>,
    safePools: {
      "demo-ray-amm": {
        ammKey: "demo-ray-amm",
        dexId: "raydium",
        liquidityUsd: 780_000,
        pairCreatedAt: Date.now() - 12 * 24 * 3_600_000,
        priceChangeH1: -4,
        priceChangeM5: -1,
        buysM5: 18,
        sellsM5: 16,
        url: null,
      },
    } as Record<string, PoolSnapshot>,
    orders: [
      {
        orderKey: "demo-order-rug-1",
        userPubkey: "demo-wallet",
        inputMint: SOL,
        outputMint: BONK,
        venue: "PumpSwap",
        rawMakingAmount: "2000000000",
        rawTakingAmount: "460000000",
        slippageBps: "900",
      },
      {
        orderKey: "demo-order-rug-2",
        userPubkey: "demo-wallet",
        inputMint: BONK,
        outputMint: SOL,
        venue: "PumpSwap",
        rawMakingAmount: "600000000",
        rawTakingAmount: "1800000000",
        slippageBps: "1200",
      },
    ],
  },
  "venue-panic": {
    baseQuote: {
      inputMint: JUP,
      inAmount: "250000000",
      outputMint: SOL,
      outAmount: "182400000",
      otherAmountThreshold: "181000000",
      swapMode: "ExactIn",
      slippageBps: 75,
      priceImpactPct: "0.22",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "demo-zero-amm",
            inputMint: JUP,
            outputMint: SOL,
            inAmount: "250000000",
            outAmount: "182400000",
            feeAmount: "80000",
            feeMint: JUP,
            label: "ZeroFi",
          },
        },
      ],
    },
    safeQuote: {
      inputMint: JUP,
      inAmount: "250000000",
      outputMint: SOL,
      outAmount: "181100000",
      otherAmountThreshold: "180000000",
      swapMode: "ExactIn",
      slippageBps: 75,
      priceImpactPct: "0.28",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "demo-meteora-amm",
            inputMint: JUP,
            outputMint: SOL,
            inAmount: "250000000",
            outAmount: "181100000",
            feeAmount: "60000",
            feeMint: JUP,
            label: "Meteora DLMM",
          },
        },
      ],
    },
    basePools: {
      "demo-zero-amm": {
        ammKey: "demo-zero-amm",
        dexId: "zerofi",
        liquidityUsd: 410_000,
        pairCreatedAt: Date.now() - 8 * 24 * 3_600_000,
        priceChangeH1: -2,
        priceChangeM5: -0.8,
        buysM5: 22,
        sellsM5: 18,
        url: null,
      },
    } as Record<string, PoolSnapshot>,
    safePools: {
      "demo-meteora-amm": {
        ammKey: "demo-meteora-amm",
        dexId: "meteora",
        liquidityUsd: 1_200_000,
        pairCreatedAt: Date.now() - 14 * 24 * 3_600_000,
        priceChangeH1: -1.2,
        priceChangeM5: -0.2,
        buysM5: 31,
        sellsM5: 25,
        url: null,
      },
    } as Record<string, PoolSnapshot>,
    orders: [
      {
        orderKey: "demo-order-venue-1",
        userPubkey: "demo-wallet",
        inputMint: JUP,
        outputMint: SOL,
        venue: "ZeroFi",
        rawMakingAmount: "125000000",
        rawTakingAmount: "92000000",
        slippageBps: "400",
      },
      {
        orderKey: "demo-order-venue-2",
        userPubkey: "demo-wallet",
        inputMint: SOL,
        outputMint: JUP,
        venue: "ZeroFi",
        rawMakingAmount: "500000000",
        rawTakingAmount: "680000000",
        slippageBps: "650",
      },
    ],
  },
  "unknown-metadata": {
    baseQuote: {
      inputMint: SOL,
      inAmount: "5000000000",
      outputMint: USDC,
      outAmount: "414000000",
      otherAmountThreshold: "412000000",
      swapMode: "ExactIn",
      slippageBps: 50,
      priceImpactPct: "0.08",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "demo-unknown-amm",
            inputMint: SOL,
            outputMint: USDC,
            inAmount: "5000000000",
            outAmount: "414000000",
            feeAmount: "200000",
            feeMint: SOL,
            label: "AlphaQ",
          },
        },
      ],
    },
    safeQuote: {
      inputMint: SOL,
      inAmount: "5000000000",
      outputMint: USDC,
      outAmount: "412900000",
      otherAmountThreshold: "411000000",
      swapMode: "ExactIn",
      slippageBps: 50,
      priceImpactPct: "0.11",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "demo-orca-amm",
            inputMint: SOL,
            outputMint: USDC,
            inAmount: "5000000000",
            outAmount: "412900000",
            feeAmount: "150000",
            feeMint: SOL,
            label: "Orca Whirlpool",
          },
        },
      ],
    },
    basePools: {} as Record<string, PoolSnapshot>,
    safePools: {
      "demo-orca-amm": {
        ammKey: "demo-orca-amm",
        dexId: "orca",
        liquidityUsd: 5_400_000,
        pairCreatedAt: Date.now() - 90 * 24 * 3_600_000,
        priceChangeH1: -0.3,
        priceChangeM5: 0.1,
        buysM5: 58,
        sellsM5: 49,
        url: null,
      },
    } as Record<string, PoolSnapshot>,
    orders: [
      {
        orderKey: "demo-order-unknown-1",
        userPubkey: "demo-wallet",
        inputMint: SOL,
        outputMint: USDC,
        venue: "AlphaQ",
        rawMakingAmount: "1000000000",
        rawTakingAmount: "82000000",
        slippageBps: "220",
      },
    ],
  },
};
