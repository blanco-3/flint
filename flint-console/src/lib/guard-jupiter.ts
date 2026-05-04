import type { JupiterQuote, TriggerOrder } from "./guard-types";

const SWAP_API_ROOT = "https://lite-api.jup.ag/swap/v1";
const TRIGGER_API_ROOT = "https://lite-api.jup.ag/trigger/v1";

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

  const response = await fetch(url.toString());
  const payload = (await response.json()) as JupiterQuote & { error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "quote_fetch_failed");
  }
  return payload;
}

export async function buildSwapTransaction(userPublicKey: string, quoteResponse: JupiterQuote) {
  const response = await fetch(`${SWAP_API_ROOT}/swap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userPublicKey,
      quoteResponse,
    }),
  });

  const payload = (await response.json()) as { error?: string; swapTransaction?: string };
  if (!response.ok || payload.error || !payload.swapTransaction) {
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

    const response = await fetch(url.toString());
    const payload = (await response.json()) as {
      error?: string;
      orders?: TriggerOrder[];
      page?: number;
      totalPages?: number;
    };
    if (!response.ok || payload.error) {
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

  const response = await fetch(`${TRIGGER_API_ROOT}/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    error?: string;
    transaction?: string;
    transactions?: string[];
  };
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "panic_cancel_build_failed");
  }
  const transactions = payload.transactions ?? (payload.transaction ? [payload.transaction] : []);
  if (!transactions.length) {
    throw new Error("panic_cancel_build_returned_no_transactions");
  }
  return { transactions };
}
