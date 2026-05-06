import type { SafetyFeedItem, SafetyFeedSnapshot } from "./guard-types";

const DEFAULT_RELAY_BASE = "http://127.0.0.1:8787";

export async function publishSafetyFeedItem(item: SafetyFeedItem, baseUrl = DEFAULT_RELAY_BASE) {
  return request(`${baseUrl}/safety-feed`, {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export async function fetchSafetyFeed(baseUrl = DEFAULT_RELAY_BASE) {
  return request(`${baseUrl}/safety-feed`, {
    method: "GET",
  }) as Promise<SafetyFeedSnapshot>;
}

export async function fetchSafetyIncident(incidentId: string, baseUrl = DEFAULT_RELAY_BASE) {
  return request(`${baseUrl}/safety-feed/${encodeURIComponent(incidentId)}`, {
    method: "GET",
  }) as Promise<SafetyFeedItem>;
}

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, {
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
