import { strict as assert } from "assert";

import { POLICY_PRESETS, canonicalPairKey, policyCopy } from "./guard-policies";
import { evaluateQuoteRisk, evaluateTriggerOrders } from "./guard-risk";
import type { JupiterQuote, PoolSnapshot, TriggerOrder } from "./guard-types";

describe("guard risk engine", () => {
  it("blocks routes that touch denylisted venues and shallow pools", () => {
    const quote: JupiterQuote = {
      inputMint: "So11111111111111111111111111111111111111112",
      inAmount: "1000000000",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outAmount: "150000000",
      otherAmountThreshold: "149000000",
      swapMode: "ExactIn",
      slippageBps: 50,
      priceImpactPct: "0.20",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "pool-a",
            inputMint: "So11111111111111111111111111111111111111112",
            outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            inAmount: "1000000000",
            outAmount: "150000000",
            feeAmount: "1000",
            feeMint: "So11111111111111111111111111111111111111112",
            label: "PumpSwap",
          },
        },
      ],
    };

    const pools: Record<string, PoolSnapshot> = {
      "pool-a": {
        ammKey: "pool-a",
        dexId: "pumpswap",
        liquidityUsd: 10_000,
        pairCreatedAt: Date.now() - 1 * 3_600_000,
        priceChangeH1: -25,
        priceChangeM5: -4,
        buysM5: 1,
        sellsM5: 5,
        url: null,
      },
    };

    const assessment = evaluateQuoteRisk(quote, pools, POLICY_PRESETS.treasury);
    assert.equal(assessment.status, "blocked");
    assert.ok(assessment.reasons.some((reason) => reason.title === "Venue denylisted"));
    assert.ok(assessment.reasons.some((reason) => reason.title === "Shallow liquidity"));
  });

  it("marks trigger orders as panic cancel candidates when pair or token is flagged", () => {
    const policy = policyCopy(POLICY_PRESETS.retail);
    const pairKey = canonicalPairKey("mint-a", "mint-b");
    policy.panicPairs = [pairKey];
    policy.panicTokens = ["mint-c"];

    const orders: TriggerOrder[] = [
      {
        orderKey: "order-a",
        userPubkey: "wallet-a",
        inputMint: "mint-a",
        outputMint: "mint-b",
        rawMakingAmount: "1000",
        rawTakingAmount: "2000",
      },
      {
        orderKey: "order-b",
        userPubkey: "wallet-a",
        inputMint: "mint-c",
        outputMint: "mint-d",
        rawMakingAmount: "1000",
        rawTakingAmount: "2000",
      },
    ];

    const assessments = evaluateTriggerOrders(orders, policy, true);
    assert.equal(assessments.length, 2);
    assert.ok(assessments.every((item) => item.candidate));
  });

  it("does not mark the selected pair as panic-cancel unless there is an actual signal", () => {
    const orders = [
      {
        orderKey: "order-a",
        userPubkey: "wallet-a",
        inputMint: "mint-a",
        outputMint: "mint-b",
        rawMakingAmount: "1000",
        rawTakingAmount: "2000",
      },
    ];

    const assessments = evaluateTriggerOrders(orders, POLICY_PRESETS.retail, true);
    assert.equal(assessments[0].candidate, false);
  });

  it("fails closed on missing metadata in treasury mode", () => {
    const quote: JupiterQuote = {
      inputMint: "mint-a",
      inAmount: "1000",
      outputMint: "mint-b",
      outAmount: "900",
      otherAmountThreshold: "850",
      swapMode: "ExactIn",
      slippageBps: 50,
      priceImpactPct: "0.05",
      routePlan: [
        {
          percent: 100,
          swapInfo: {
            ammKey: "missing-pool",
            inputMint: "mint-a",
            outputMint: "mint-b",
            inAmount: "1000",
            outAmount: "900",
            feeAmount: "1",
            feeMint: "mint-a",
            label: "AlphaQ",
          },
        },
      ],
    };

    const assessment = evaluateQuoteRisk(quote, {}, POLICY_PRESETS.treasury);
    assert.equal(assessment.status, "blocked");
    assert.ok(
      assessment.reasons.some(
        (reason) =>
          reason.title === "Pool metadata unavailable" && reason.blocking === true
      )
    );
    assert.ok(assessment.blockedVenues.includes("AlphaQ"));
  });
});
