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
  HttpError,
};
