const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { createRelayServer } = require("./server");

function createMemoryStore() {
  const requests = new Map();

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

  server.close();
});
