import { strict as assert } from "assert";

import {
  FlintGuardSafetyFeedClient,
  type SafetyFeedItem,
} from "./flint-guard-safety-feed";

describe("FlintGuardSafetyFeedClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("publishes and fetches safety feed data", async () => {
    const client = new FlintGuardSafetyFeedClient("http://relay.local");
    const item: SafetyFeedItem = {
      incidentId: "incident-1",
      bundleId: "bundle-1",
      profile: "retail-user",
      severity: "critical",
      posture: "degraded",
      executionRecommendation: "prefer-safe-route",
      headline: "Use safer route",
      summary: "Critical venue panic",
      candidateOrderCount: 1,
      blockedRoute: false,
      affectedTokens: [],
      affectedPairs: [],
      affectedVenues: [],
      nextActions: ["Use safer route"],
    };

    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/safety-feed") && init?.method === "POST") {
        return new Response(JSON.stringify(item), { status: 200 });
      }
      if (url.endsWith("/safety-feed")) {
        return new Response(
          JSON.stringify({
            itemCount: 1,
            criticalCount: 1,
            degradedCount: 1,
            blockedCount: 0,
            items: [item],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify(item), { status: 200 });
    }) as typeof fetch;

    const published = await client.publishFeedItem(item);
    assert.equal(published.bundleId, "bundle-1");
    const feed = await client.getSafetyFeed();
    assert.equal(feed.items[0].incidentId, "incident-1");
    const incident = await client.getSafetyIncident("incident-1");
    assert.equal(incident.bundleId, "bundle-1");
  });

  it("surfaces API errors", async () => {
    const client = new FlintGuardSafetyFeedClient("http://relay.local");
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "bad_request" }), { status: 400 })) as typeof fetch;

    await assert.rejects(async () => client.getSafetyFeed(), /bad_request/);
  });

  it("encodes incident ids when fetching one incident", async () => {
    const client = new FlintGuardSafetyFeedClient("http://relay.local");
    let requestedUrl = "";
    globalThis.fetch = (async (input: string | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          incidentId: "incident/with?reserved#chars",
          bundleId: "bundle-2",
          profile: "retail-user",
          severity: "watch",
          posture: "clear",
          executionRecommendation: "allow-best-route",
          headline: "Encoded",
          summary: "Encoded fetch",
          candidateOrderCount: 0,
          blockedRoute: false,
          affectedTokens: [],
          affectedPairs: [],
          affectedVenues: [],
          nextActions: [],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    await client.getSafetyIncident("incident/with?reserved#chars");
    assert.ok(requestedUrl.includes("incident%2Fwith%3Freserved%23chars"));
  });
});
