export type QuoteRequestInput = {
  requestId?: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  minOutputAmount: string;
  user?: string | null;
  integrator?: string | null;
  callbackUrl?: string | null;
  quoteDeadlineMs?: number;
  metadata?: Record<string, unknown>;
};

export type SolverQuoteInput = {
  requestId: string;
  quoteId?: string;
  solverId: string;
  outputAmount: string;
  validUntil?: string;
  route?: Record<string, unknown> | null;
  quoteSignature?: string | null;
  metadata?: Record<string, unknown>;
};

export type ExecuteInput = {
  requestId: string;
  selectedQuoteId?: string;
  executionResult?: Record<string, unknown>;
};

export class FlintRelayClient {
  constructor(private readonly baseUrl: string) {}

  async createQuoteRequest(input: QuoteRequestInput) {
    return this.request("/quote-request", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async submitSolverQuote(input: SolverQuoteInput) {
    return this.request("/solver/quote", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async executeRequest(input: ExecuteInput) {
    return this.request("/execute", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getStatus(requestId: string) {
    return this.request(`/status/${requestId}`, {
      method: "GET",
    });
  }

  async listQuoteRequests(status?: string) {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(`/quote-requests${suffix}`, {
      method: "GET",
    });
  }

  private async request(path: string, init: RequestInit) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `request failed: ${response.status}`);
    }

    return payload;
  }
}
