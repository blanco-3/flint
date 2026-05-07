import { strict as assert } from "assert";

import { searchDexTokenOptions } from "./token-options";

describe("token option discovery", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns an empty result instead of throwing on rate-limit text", async () => {
    globalThis.fetch = (async () =>
      new Response("Rate limit exceeded", { status: 429 })) as typeof fetch;

    const results = await searchDexTokenOptions("jup");
    assert.deepEqual(results, []);
  });
});
