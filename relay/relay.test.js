const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { createRelayServer } = require("./server");

function createMemoryStore() {
  const requests = new Map();
  const safetyFeed = new Map();

  return {
    async createRequest(request) {
      requests.set(request.requestId, structuredClone(request));
      return structuredClone(request);
    },
    async updateRequest(requestId, updater) {
      const current = requests.get(requestId);
      if (!current) return null;
      const next = updater(structuredClone(current));
      requests.set(requestId, structuredClone(next));
      return structuredClone(next);
    },
    async getRequest(requestId) {
      return requests.has(requestId) ? structuredClone(requests.get(requestId)) : null;
    },
    async listRequests({ status } = {}) {
      const all = [...requests.values()].map((item) => structuredClone(item));
      return status ? all.filter((item) => item.status === status) : all;
    },
    async upsertSafetyIncident(item) {
      safetyFeed.set(item.incidentId, structuredClone(item));
      return structuredClone(item);
    },
    async getSafetyIncident(incidentId) {
      return safetyFeed.has(incidentId) ? structuredClone(safetyFeed.get(incidentId)) : null;
    },
    async listSafetyFeed() {
      return [...safetyFeed.values()].map((item) => structuredClone(item));
    },
  };
}

test("relay lifecycle creates, quotes, selects, and reports status", async () => {
  const store = createMemoryStore();
  const server = createRelayServer({
    store,
    notifier: async () => {},
    now: (() => {
      let time = Date.parse("2026-01-01T00:00:00.000Z");
      return () => {
        const current = new Date(time);
        time += 10;
        return current;
      };
    })(),
  });

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const createResponse = await fetch(`${base}/quote-request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "req-1",
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "USDC111111111111111111111111111111111111111",
      inputAmount: "1000000",
      minOutputAmount: "990000",
      user: "user-1",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.requestId, "req-1");
  assert.equal(created.status, "open");

  const quoteResponse = await fetch(`${base}/solver/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "req-1",
      solverId: "solver-a",
      outputAmount: "1010000",
      route: { venue: "jupiterz" },
    }),
  });
  assert.equal(quoteResponse.status, 201);

  await fetch(`${base}/solver/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "req-1",
      solverId: "solver-b",
      outputAmount: "1020000",
      route: { venue: "jupiter-ultra" },
    }),
  });

  const executeResponse = await fetch(`${base}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "req-1",
    }),
  });
  assert.equal(executeResponse.status, 200);
  const executed = await executeResponse.json();
  assert.equal(executed.status, "selected");
  assert.equal(executed.selectedQuote.solverId, "solver-b");
  assert.equal(executed.executionPlan.kernel, "flint-v1");

  const statusResponse = await fetch(`${base}/status/req-1`);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.selectedQuoteId, executed.selectedQuote.quoteId);
  assert.equal(status.quotes.length, 2);

  const solversResponse = await fetch(`${base}/solvers`);
  assert.equal(solversResponse.status, 200);
  const solvers = await solversResponse.json();
  assert.equal(solvers.solvers.length, 2);

  const analyticsResponse = await fetch(`${base}/analytics/summary`);
  assert.equal(analyticsResponse.status, 200);
  const analytics = await analyticsResponse.json();
  assert.equal(analytics.totalRequests, 1);
  assert.equal(analytics.quoteCount, 2);

  const publishFeedResponse = await fetch(`${base}/safety-feed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      incidentId: "incident-1",
      bundleId: "bundle-1",
      profile: "retail-user",
      severity: "critical",
      posture: "degraded",
      executionRecommendation: "prefer-safe-route",
      headline: "Use the safer route",
      summary: "Critical venue panic",
      candidateOrderCount: 1,
      blockedRoute: false,
      affectedTokens: ["token-a"],
      affectedPairs: ["pair-a"],
      affectedVenues: ["venue-a"],
      nextActions: ["Use safer route"],
    }),
  });
  assert.equal(publishFeedResponse.status, 201);

  const feedResponse = await fetch(`${base}/safety-feed`);
  assert.equal(feedResponse.status, 200);
  const feed = await feedResponse.json();
  assert.equal(feed.itemCount, 1);
  assert.equal(feed.criticalCount, 1);

  const incidentResponse = await fetch(`${base}/safety-feed/incident-1`);
  assert.equal(incidentResponse.status, 200);
  const incident = await incidentResponse.json();
  assert.equal(incident.bundleId, "bundle-1");

  server.close();
});

test("relay safety feed rejects invalid enum values", async () => {
  const store = createMemoryStore();
  const server = createRelayServer({
    store,
    notifier: async () => {},
  });

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const response = await fetch(`${base}/safety-feed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      incidentId: "incident-x",
      bundleId: "bundle-x",
      profile: "invalid-profile",
      severity: "critical",
      posture: "degraded",
      executionRecommendation: "prefer-safe-route",
      headline: "Bad payload",
      summary: "Should fail",
      candidateOrderCount: 0,
      blockedRoute: false,
      affectedTokens: [],
      affectedPairs: [],
      affectedVenues: [],
      nextActions: [],
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, "invalid_profile");

  server.close();
});

test("relay safety feed upserts by incident id", async () => {
  const store = createMemoryStore();
  const server = createRelayServer({
    store,
    notifier: async () => {},
  });

  server.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const payload = {
    incidentId: "incident-upsert",
    bundleId: "bundle-1",
    profile: "retail-user",
    severity: "watch",
    posture: "clear",
    executionRecommendation: "allow-best-route",
    headline: "Baseline watch",
    summary: "Initial state",
    candidateOrderCount: 0,
    blockedRoute: false,
    affectedTokens: [],
    affectedPairs: [],
    affectedVenues: [],
    nextActions: [],
  };

  await fetch(`${base}/safety-feed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  await fetch(`${base}/safety-feed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      bundleId: "bundle-2",
      severity: "critical",
      summary: "Updated state",
    }),
  });

  const incidentResponse = await fetch(`${base}/safety-feed/incident-upsert`);
  const incident = await incidentResponse.json();
  assert.equal(incident.bundleId, "bundle-2");
  assert.equal(incident.severity, "critical");

  const feedResponse = await fetch(`${base}/safety-feed`);
  const feed = await feedResponse.json();
  assert.equal(feed.itemCount, 1);

  server.close();
});
