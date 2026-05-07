import type { SafetyFeedItem, SafetyFeedSnapshot, WatchServerSnapshot } from "./guard-types";

const DEFAULT_RELAY_BASE = "http://127.0.0.1:8787";
const REQUEST_TIMEOUT_MS = 5000;

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

export async function updateSafetyIncidentState(
  incidentId: string,
  state: SafetyFeedItem["state"],
  baseUrl = DEFAULT_RELAY_BASE
) {
  return request(`${baseUrl}/safety-feed/${encodeURIComponent(incidentId)}/state`, {
    method: "POST",
    body: JSON.stringify({ state }),
  }) as Promise<SafetyFeedItem>;
}

export async function fetchWatchSnapshot(baseUrl = DEFAULT_RELAY_BASE, refresh = false) {
  const suffix = refresh ? "?refresh=1" : "";
  return request(`${baseUrl}/watch/snapshot${suffix}`, {
    method: "GET",
  }) as Promise<WatchServerSnapshot>;
}

export function subscribeWatchStream(
  onSnapshot: (snapshot: WatchServerSnapshot) => void,
  onError?: (error: string) => void,
  baseUrl = DEFAULT_RELAY_BASE
) {
  const streamUrl = `${baseUrl.replace(/^http/, "http")}/watch/stream`;
  const source = new EventSource(streamUrl);

  source.addEventListener("snapshot", (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as WatchServerSnapshot;
      onSnapshot(payload);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "watch_stream_parse_failed");
    }
  });

  source.addEventListener("degraded", (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data) as { error?: string };
      onError?.(payload.error ?? "watch_stream_degraded");
    } catch {
      onError?.("watch_stream_degraded");
    }
  });

  source.onerror = () => {
    onError?.("watch_stream_unavailable");
  };

  return () => {
    source.close();
  };
}

async function request(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
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
