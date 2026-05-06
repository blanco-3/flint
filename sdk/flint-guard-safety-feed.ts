export type SafetyFeedItem = {
  incidentId: string;
  bundleId: string;
  profile: "retail-user" | "treasury-operator" | "bot-executor" | "partner-app";
  severity: "watch" | "elevated" | "critical";
  posture: "clear" | "caution" | "degraded" | "blocked";
  executionRecommendation: "allow-best-route" | "prefer-safe-route" | "block-execution";
  headline: string;
  summary: string;
  candidateOrderCount: number;
  blockedRoute: boolean;
  affectedTokens: string[];
  affectedPairs: string[];
  affectedVenues: string[];
  nextActions: string[];
};

export type SafetyFeedSnapshot = {
  itemCount: number;
  criticalCount: number;
  degradedCount: number;
  blockedCount: number;
  items: SafetyFeedItem[];
};

export class FlintGuardSafetyFeedClient {
  constructor(private readonly baseUrl: string) {}

  async publishFeedItem(input: SafetyFeedItem) {
    return this.request("/safety-feed", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getSafetyFeed() {
    return this.request("/safety-feed", {
      method: "GET",
    });
  }

  async getSafetyIncident(incidentId: string) {
    return this.request(`/safety-feed/${encodeURIComponent(incidentId)}`, {
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
