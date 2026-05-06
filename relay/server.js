const http = require("http");
const { URL } = require("url");
const { randomUUID } = require("crypto");

const PROGRAM_ID = "5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt";

function createRelayServer({ store, notifier = async () => {}, now = () => new Date() }) {
  async function handleRequest(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { ok: true, service: "flint-relay-alpha" });
      }

      if (req.method === "GET" && url.pathname === "/quote-requests") {
        const status = url.searchParams.get("status") || undefined;
        const requests = await store.listRequests({ status });
        return sendJson(res, 200, { requests });
      }

      if (req.method === "GET" && url.pathname === "/solvers") {
        const requests = await store.listRequests();
        const solvers = deriveSolverSummary(requests);
        return sendJson(res, 200, { solvers });
      }

      if (req.method === "GET" && url.pathname === "/analytics/summary") {
        const requests = await store.listRequests();
        const summary = deriveAnalyticsSummary(requests);
        return sendJson(res, 200, summary);
      }

      if (req.method === "GET" && url.pathname === "/safety-feed") {
        const items = await store.listSafetyFeed();
        return sendJson(res, 200, buildSafetyFeedSnapshot(items));
      }

      if (req.method === "GET" && url.pathname.startsWith("/safety-feed/")) {
        const incidentId = decodeURIComponent(url.pathname.split("/").pop());
        const item = await store.getSafetyIncident(incidentId);
        if (!item) {
          return sendJson(res, 404, { error: "incident_not_found" });
        }
        return sendJson(res, 200, item);
      }

      if (req.method === "GET" && url.pathname.startsWith("/status/")) {
        const requestId = url.pathname.split("/").pop();
        const request = await store.getRequest(requestId);
        if (!request) {
          return sendJson(res, 404, { error: "request_not_found" });
        }
        return sendJson(res, 200, request);
      }

      if (req.method === "POST" && url.pathname === "/quote-request") {
        const body = await readJson(req);
        validateQuoteRequest(body);

        const createdAt = now().toISOString();
        const quoteDeadlineMs = Number(body.quoteDeadlineMs ?? 2000);
        const quoteDeadlineAt = new Date(now().getTime() + quoteDeadlineMs).toISOString();
        const request = {
          requestId: body.requestId ?? randomUUID(),
          status: "open",
          createdAt,
          quoteDeadlineAt,
          executionKernel: "flint-v1",
          inputMint: body.inputMint,
          outputMint: body.outputMint,
          inputAmount: String(body.inputAmount),
          minOutputAmount: String(body.minOutputAmount),
          user: body.user ?? null,
          integrator: body.integrator ?? null,
          callbackUrl: body.callbackUrl ?? null,
          metadata: body.metadata ?? {},
          quotes: [],
          selectedQuoteId: null,
          executionPlan: null,
          executionResult: null,
        };

        await store.createRequest(request);
        await safeNotify(notifier, request.callbackUrl, {
          type: "quote_request.created",
          requestId: request.requestId,
          status: request.status,
          quoteDeadlineAt: request.quoteDeadlineAt,
        });

        return sendJson(res, 201, {
          requestId: request.requestId,
          status: request.status,
          quoteDeadlineAt: request.quoteDeadlineAt,
          executionKernel: request.executionKernel,
        });
      }

      if (req.method === "POST" && url.pathname === "/solver/quote") {
        const body = await readJson(req);
        validateSolverQuote(body);

        const request = await store.updateRequest(body.requestId, (existing) => {
          if (existing.status !== "open" && existing.status !== "quoted") {
            throw new HttpError(409, "request_not_open_for_quotes");
          }

          if (new Date(existing.quoteDeadlineAt).getTime() < now().getTime()) {
            throw new HttpError(409, "quote_deadline_elapsed");
          }

          const quote = {
            quoteId: body.quoteId ?? randomUUID(),
            solverId: body.solverId,
            outputAmount: String(body.outputAmount),
            validUntil: body.validUntil ?? existing.quoteDeadlineAt,
            route: body.route ?? null,
            quoteSignature: body.quoteSignature ?? null,
            metadata: body.metadata ?? {},
            createdAt: now().toISOString(),
          };

          existing.quotes.push(quote);
          existing.status = "quoted";
          return existing;
        });

        if (!request) {
          return sendJson(res, 404, { error: "request_not_found" });
        }

        const latestQuote = request.quotes[request.quotes.length - 1];
        await safeNotify(notifier, request.callbackUrl, {
          type: "quote_request.quote_received",
          requestId: request.requestId,
          status: request.status,
          quote: latestQuote,
        });

        return sendJson(res, 201, {
          requestId: request.requestId,
          status: request.status,
          quoteId: latestQuote.quoteId,
        });
      }

      if (req.method === "POST" && url.pathname === "/execute") {
        const body = await readJson(req);
        const request = await store.updateRequest(body.requestId, (existing) => {
          if (!existing.quotes.length) {
            throw new HttpError(409, "no_quotes_available");
          }

          const selectedQuote =
            body.selectedQuoteId == null
              ? pickBestQuote(existing.quotes)
              : existing.quotes.find((quote) => quote.quoteId === body.selectedQuoteId);

          if (!selectedQuote) {
            throw new HttpError(404, "selected_quote_not_found");
          }

          const plan = buildExecutionPlan(existing, selectedQuote);
          existing.selectedQuoteId = selectedQuote.quoteId;
          existing.status = "selected";
          existing.executionPlan = plan;

          if (body.executionResult) {
            existing.status = "executed";
            existing.executionResult = body.executionResult;
          }

          return existing;
        });

        if (!request) {
          return sendJson(res, 404, { error: "request_not_found" });
        }

        const selectedQuote = request.quotes.find(
          (quote) => quote.quoteId === request.selectedQuoteId
        );
        await safeNotify(notifier, request.callbackUrl, {
          type: request.executionResult ? "quote_request.executed" : "quote_request.selected",
          requestId: request.requestId,
          status: request.status,
          selectedQuote,
        });

        return sendJson(res, 200, {
          requestId: request.requestId,
          status: request.status,
          selectedQuote,
          executionPlan: request.executionPlan,
          executionResult: request.executionResult,
        });
      }

      if (req.method === "POST" && url.pathname === "/safety-feed") {
        const body = await readJson(req);
        const item = validateSafetyFeedItem(body);
        const stored = await store.upsertSafetyIncident(item);
        return sendJson(res, 201, stored);
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "internal_error";
      return sendJson(res, status, { error: message });
    }
  }

  return http.createServer((req, res) => {
    void handleRequest(req, res);
  });
}

function buildExecutionPlan(request, selectedQuote) {
  return {
    kernel: "flint-v1",
    programId: PROGRAM_ID,
    requestId: request.requestId,
    selectedSolverId: selectedQuote.solverId,
    quoteId: selectedQuote.quoteId,
    quoteValidity: {
      validUntil: selectedQuote.validUntil,
      quoteDeadlineAt: request.quoteDeadlineAt,
    },
    quote: {
      outputAmount: selectedQuote.outputAmount,
      route: selectedQuote.route,
      quoteSignature: selectedQuote.quoteSignature,
    },
    transactionPlan: {
      phase1: {
        instruction: "submit_intent",
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        inputAmount: request.inputAmount,
        minOutputAmount: request.minOutputAmount,
        user: request.user,
      },
      phase2: {
        instruction: "submit_bid",
        solverRegistryRequired: true,
        selectedSolverId: selectedQuote.solverId,
      },
      terminalPaths: ["settle_auction", "refund_after_timeout"],
    },
  };
}

function pickBestQuote(quotes) {
  return [...quotes].sort((a, b) => BigInt(b.outputAmount) > BigInt(a.outputAmount) ? 1 : -1)[0];
}

function deriveSolverSummary(requests) {
  const map = new Map();

  for (const request of requests) {
    for (const quote of request.quotes ?? []) {
      const current = map.get(quote.solverId) ?? {
        solverId: quote.solverId,
        label: quote.solverId,
        quoteCount: 0,
        selectedCount: 0,
        timeoutCount: 0,
        activeExposure: 0,
      };

      current.quoteCount += 1;
      if (request.selectedQuoteId === quote.quoteId) {
        current.selectedCount += 1;
        if (request.status === "refunded") {
          current.timeoutCount += 1;
        }
        if (request.status === "open" || request.status === "quoted" || request.status === "selected") {
          current.activeExposure += 1;
        }
      }

      map.set(quote.solverId, current);
    }
  }

  return [...map.values()].map((solver, index) => {
    const settleRate = solver.selectedCount
      ? round((solver.selectedCount - solver.timeoutCount) / solver.selectedCount)
      : 0;
    const timeoutRate = solver.selectedCount
      ? round(solver.timeoutCount / solver.selectedCount)
      : 0;

    return {
      id: solver.solverId,
      label: solver.label,
      stake: "derived",
      reputation: Math.max(0, 100 - Math.round(timeoutRate * 100)),
      settleRate,
      timeoutRate,
      activeExposure: String(solver.activeExposure),
      quoteCount: solver.quoteCount,
    };
  });
}

function deriveAnalyticsSummary(requests) {
  const totalRequests = requests.length;
  const settled = requests.filter((request) => request.status === "executed").length;
  const refunded = requests.filter((request) => request.status === "refunded").length;

  let totalImprovementBps = 0;
  let improvementSamples = 0;

  for (const request of requests) {
    if (!request.executionPlan?.quote?.outputAmount || !request.minOutputAmount) continue;
    const minOutput = BigInt(request.minOutputAmount);
    const selectedOutput = BigInt(request.executionPlan.quote.outputAmount);
    if (minOutput === 0n) continue;
    totalImprovementBps += Number(((selectedOutput - minOutput) * 10_000n) / minOutput);
    improvementSamples += 1;
  }

  return {
    totalRequests,
    settlementRate: totalRequests ? round(settled / totalRequests) : 0,
    timeoutRate: totalRequests ? round(refunded / totalRequests) : 0,
    avgImprovementBps: improvementSamples ? Math.round(totalImprovementBps / improvementSamples) : 0,
    quoteCount: requests.reduce((sum, request) => sum + (request.quotes?.length ?? 0), 0),
    benchmark: {
      singleSolverBaselineBps: 105,
      twoSolverCompetitionBps: 315,
      timeoutRecovery: true,
    },
  };
}

function round(value) {
  return Number((value * 100).toFixed(1));
}

function buildSafetyFeedSnapshot(items) {
  return {
    itemCount: items.length,
    criticalCount: items.filter((item) => item.severity === "critical").length,
    degradedCount: items.filter((item) => item.posture === "degraded").length,
    blockedCount: items.filter((item) => item.blockedRoute).length,
    items,
  };
}

function validateQuoteRequest(body) {
  for (const field of ["inputMint", "outputMint", "inputAmount", "minOutputAmount"]) {
    if (!body[field]) {
      throw new HttpError(400, `missing_${field}`);
    }
  }
}

function validateSolverQuote(body) {
  for (const field of ["requestId", "solverId", "outputAmount"]) {
    if (!body[field]) {
      throw new HttpError(400, `missing_${field}`);
    }
  }
}

function validateSafetyFeedItem(body) {
  const allowedProfiles = new Set([
    "retail-user",
    "treasury-operator",
    "bot-executor",
    "partner-app",
  ]);
  const allowedSeverities = new Set(["watch", "elevated", "critical"]);
  const allowedPostures = new Set(["clear", "caution", "degraded", "blocked"]);
  const allowedRecommendations = new Set([
    "allow-best-route",
    "prefer-safe-route",
    "block-execution",
  ]);

  for (const field of [
    "incidentId",
    "bundleId",
    "profile",
    "severity",
    "posture",
    "executionRecommendation",
    "headline",
    "summary",
  ]) {
    if (!body[field]) {
      throw new HttpError(400, `missing_${field}`);
    }
  }

  if (typeof body.candidateOrderCount !== "number") {
    throw new HttpError(400, "invalid_candidateOrderCount");
  }

  if (typeof body.blockedRoute !== "boolean") {
    throw new HttpError(400, "invalid_blockedRoute");
  }

  if (!allowedProfiles.has(body.profile)) {
    throw new HttpError(400, "invalid_profile");
  }

  if (!allowedSeverities.has(body.severity)) {
    throw new HttpError(400, "invalid_severity");
  }

  if (!allowedPostures.has(body.posture)) {
    throw new HttpError(400, "invalid_posture");
  }

  if (!allowedRecommendations.has(body.executionRecommendation)) {
    throw new HttpError(400, "invalid_executionRecommendation");
  }

  for (const field of ["affectedTokens", "affectedPairs", "affectedVenues", "nextActions"]) {
    if (!Array.isArray(body[field]) || !body[field].every((item) => typeof item === "string")) {
      throw new HttpError(400, `invalid_${field}`);
    }
  }

  return {
    incidentId: String(body.incidentId),
    bundleId: String(body.bundleId),
    profile: body.profile,
    severity: body.severity,
    posture: body.posture,
    executionRecommendation: body.executionRecommendation,
    headline: String(body.headline),
    summary: String(body.summary),
    candidateOrderCount: body.candidateOrderCount,
    blockedRoute: body.blockedRoute,
    affectedTokens: [...body.affectedTokens],
    affectedPairs: [...body.affectedPairs],
    affectedVenues: [...body.affectedVenues],
    nextActions: [...body.nextActions],
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
  });
  res.end(JSON.stringify(body));
}

async function safeNotify(notifier, url, payload) {
  try {
    await notifier(url, payload);
  } catch (_) {
    // Alpha relay should not fail request handling because a webhook endpoint is down.
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  createRelayServer,
  buildExecutionPlan,
  pickBestQuote,
  deriveSolverSummary,
  deriveAnalyticsSummary,
  buildSafetyFeedSnapshot,
  HttpError,
};
