import { strict as assert } from "assert";

import { buildCancelTransactions, fetchTriggerOrders } from "./guard-jupiter";

describe("guard Jupiter adapters", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("aggregates trigger orders across pages", async () => {
    let callCount = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      callCount += 1;
      const page = new URL(url).searchParams.get("page");
      const payload =
        page === "1"
          ? {
              orders: [{ orderKey: "one", userPubkey: "wallet", inputMint: "a", outputMint: "b", rawMakingAmount: "1", rawTakingAmount: "2" }],
              page: 1,
              totalPages: 2,
            }
          : {
              orders: [{ orderKey: "two", userPubkey: "wallet", inputMint: "c", outputMint: "d", rawMakingAmount: "3", rawTakingAmount: "4" }],
              page: 2,
              totalPages: 2,
            };
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch;

    const response = await fetchTriggerOrders("wallet");
    assert.equal(callCount, 2);
    assert.equal(response.orders.length, 2);
    assert.equal(response.orders[0].orderKey, "one");
    assert.equal(response.orders[1].orderKey, "two");
  });

  it("fails if cancel builder returns no transactions", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), { status: 200 })) as typeof fetch;

    await assert.rejects(
      async () => buildCancelTransactions("wallet", ["order-1"]),
      /panic_cancel_build_returned_no_transactions/
    );
  });
});
