import type { JupiterPriceEntry, JupiterQuote, TriggerOrder } from "./guard-types";

const SWAP_API_ROOT = "https://lite-api.jup.ag/swap/v1";
const TRIGGER_API_ROOT = "https://lite-api.jup.ag/trigger/v1";
const PRICE_API_ROOT = "https://api.jup.ag/price/v3";
const REQUEST_TIMEOUT_MS = 12000;
const QUOTE_CACHE_MS = 15000;
const PRICE_CACHE_MS = 15000;
const RATE_LIMIT_COOLDOWN_MS = 12000;

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const rateLimitBuckets = new Map<string, number>();

export function resetJupiterAdapterStateForTests() {
  responseCache.clear();
  inFlightRequests.clear();
  rateLimitBuckets.clear();
}

export async function fetchQuote(input: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  excludeDexes?: string[];
  onlyDirectRoutes?: boolean;
}) {
  const url = new URL(`${SWAP_API_ROOT}/quote`);
  url.searchParams.set("inputMint", input.inputMint);
  url.searchParams.set("outputMint", input.outputMint);
  url.searchParams.set("amount", input.amount);
  url.searchParams.set("slippageBps", String(input.slippageBps));

  if (input.excludeDexes && input.excludeDexes.length) {
    url.searchParams.set("excludeDexes", input.excludeDexes.join(","));
  }

  if (input.onlyDirectRoutes) {
    url.searchParams.set("onlyDirectRoutes", "true");
  }

  const payload = await requestJson<JupiterQuote & { error?: string }>(url.toString(), undefined, {
    cacheKey: `quote:${url.toString()}`,
    cacheTtlMs: QUOTE_CACHE_MS,
    rateLimitBucket: "quote",
  });
  if (payload.error) {
    throw new Error(payload.error || "quote_fetch_failed");
  }
  return payload;
}

export async function buildSwapTransaction(userPublicKey: string, quoteResponse: JupiterQuote) {
  const payload = await requestJson<{ error?: string; swapTransaction?: string }>(
    `${SWAP_API_ROOT}/swap`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userPublicKey,
        quoteResponse,
      }),
    },
    {
      rateLimitBucket: "swap",
    }
  );
  if (payload.error || !payload.swapTransaction) {
    throw new Error(payload.error || "swap_transaction_build_failed");
  }
  return {
    swapTransaction: payload.swapTransaction,
  };
}

export async function fetchTriggerOrders(user: string) {
  const orders: TriggerOrder[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = new URL(`${TRIGGER_API_ROOT}/getTriggerOrders`);
    url.searchParams.set("user", user);
    url.searchParams.set("orderStatus", "active");
    url.searchParams.set("page", String(page));

    const payload = await requestJson<{
      error?: string;
      orders?: TriggerOrder[];
      page?: number;
      totalPages?: number;
    }>(url.toString(), undefined, {
      cacheKey: `trigger:${url.toString()}`,
      cacheTtlMs: 5000,
      rateLimitBucket: "trigger",
    });
    if (payload.error) {
      throw new Error(payload.error || "trigger_order_fetch_failed");
    }

    orders.push(...(payload.orders ?? []));
    totalPages = payload.totalPages ?? 1;
    page += 1;
  }

  return {
    orders: orders,
    page: 1,
    totalPages: totalPages,
  };
}

export async function buildCancelTransactions(maker: string, orders: string[]) {
  const endpoint = orders.length <= 1 ? "cancelOrder" : "cancelOrders";
  let body: Record<string, string | string[]>;
  if (orders.length <= 1) {
    body = {
      maker,
      order: orders[0],
      computeUnitPrice: "auto",
    };
  } else {
    body = {
      maker,
      orders,
      computeUnitPrice: "auto",
    };
  }

  const payload = await requestJson<{
    error?: string;
    transaction?: string;
    transactions?: string[];
  }>(`${TRIGGER_API_ROOT}/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }, {
    rateLimitBucket: "trigger",
  });
  if (payload.error) {
    throw new Error(payload.error || "panic_cancel_build_failed");
  }
  const transactions = payload.transactions ?? (payload.transaction ? [payload.transaction] : []);
  if (!transactions.length) {
    throw new Error("panic_cancel_build_returned_no_transactions");
  }
  return { transactions };
}

export async function fetchPrices(mints: string[]) {
  const ids = Array.from(new Set(mints.filter(Boolean))).slice(0, 50);
  if (!ids.length) return {} as Record<string, JupiterPriceEntry>;
  const url = new URL(PRICE_API_ROOT);
  url.searchParams.set("ids", ids.join(","));
  return requestJson<Record<string, JupiterPriceEntry>>(url.toString(), undefined, {
    cacheKey: `price:${url.toString()}`,
    cacheTtlMs: PRICE_CACHE_MS,
    rateLimitBucket: "price",
  });
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  options?: {
    cacheKey?: string;
    cacheTtlMs?: number;
    rateLimitBucket?: string;
  }
) {
  const cacheKey = options?.cacheKey ?? null;
  if (cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      return (await inFlight) as T;
    }
  }

  if (options?.rateLimitBucket) {
    const cooldownUntil = rateLimitBuckets.get(options.rateLimitBucket) ?? 0;
    if (cooldownUntil > Date.now()) {
      throw new Error("rate_limited");
    }
  }

  const requestPromise = requestJsonUncached<T>(url, init, options);
  if (cacheKey) {
    inFlightRequests.set(cacheKey, requestPromise as Promise<unknown>);
  }

  try {
    const value = await requestPromise;
    if (cacheKey && options?.cacheTtlMs) {
      responseCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + options.cacheTtlMs,
      });
    }
    return value;
  } finally {
    if (cacheKey) {
      inFlightRequests.delete(cacheKey);
    }
  }
}

async function requestJsonUncached<T>(
  url: string,
  init?: RequestInit,
  options?: { rateLimitBucket?: string }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const raw = await response.text();
    const payload = safeParseJson<T & { error?: string }>(raw);
    if (!response.ok) {
      const message =
        payload?.error ||
        describeHttpFailure(response.status, raw) ||
        `request failed: ${response.status}`;
      if (message === "rate_limited" && options?.rateLimitBucket) {
        rateLimitBuckets.set(options.rateLimitBucket, Date.now() + RATE_LIMIT_COOLDOWN_MS);
      }
      throw new Error(message);
    }
    if (!payload) {
      throw new Error("invalid_json_response");
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("request_timeout");
    }
    if (error instanceof TypeError) {
      throw new Error("network_unavailable");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeParseJson<T>(raw: string) {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function describeHttpFailure(status: number, raw: string) {
  const normalized = raw.trim();
  if (status === 429 || /^rate limit/i.test(normalized)) {
    return "rate_limited";
  }
  return normalized ? normalized.slice(0, 200) : null;
}
