import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import deployArtifact from "../../artifacts/devnet-deploy.json";
import happyArtifact from "../../artifacts/devnet-smoke-happy.json";
import timeoutArtifact from "../../artifacts/devnet-smoke-timeout.json";
import benchmarkArtifact from "../../artifacts/benchmark-local.json";
import "./index.css";

type RelayQuote = {
  quoteId: string;
  solverId: string;
  outputAmount: string;
  validUntil: string;
};

type RelayRequest = {
  requestId: string;
  status: string;
  createdAt?: string;
  quoteDeadlineAt?: string;
  inputMint?: string;
  outputMint?: string;
  inputAmount?: string;
  minOutputAmount?: string;
  integrator?: string | null;
  callbackUrl?: string | null;
  quotes?: RelayQuote[];
  selectedQuoteId?: string | null;
  executionPlan?: {
    selectedSolverId?: string;
    quote?: {
      outputAmount?: string;
    };
  } | null;
  proofExplorer?: string;
  proofKind?: "happy" | "timeout";
};

const HERO_IMAGE =
  "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=1800&q=80";
const PROOF_IMAGE =
  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80";
const RELAY_BASE =
  (import.meta.env.VITE_FLINT_RELAY_BASE as string | undefined) ?? "http://127.0.0.1:8787";

const benchmarkByName = benchmarkArtifact.scenarios.reduce<
  Record<string, (typeof benchmarkArtifact.scenarios)[number]>
>((acc, scenario) => {
  acc[scenario.name] = scenario;
  return acc;
}, {});

function App() {
  const [mode, setMode] = useState<"seeded" | "live">("seeded");
  const [relayHealth, setRelayHealth] = useState<"unknown" | "live" | "down">("unknown");
  const [requests, setRequests] = useState<RelayRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<RelayRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState({
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "USDC111111111111111111111111111111111111111",
    inputAmount: "1000000",
    minOutputAmount: "990000",
    integrator: "flint-console",
    callbackUrl: "",
  });

  const seededRequests = useMemo<RelayRequest[]>(
    () => [
      {
        requestId: "devnet-happy",
        status: "executed",
        createdAt: happyArtifact.submitIntentSignature,
        quoteDeadlineAt: happyArtifact.submitBidSignature,
        inputAmount: "100000000",
        minOutputAmount: "95000000",
        integrator: "judge-demo",
        quotes: [
          {
            quoteId: happyArtifact.winningBid,
            solverId: happyArtifact.solver,
            outputAmount: "98000000",
            validUntil: happyArtifact.terminalSignature,
          },
        ],
        selectedQuoteId: happyArtifact.winningBid,
        executionPlan: {
          selectedSolverId: happyArtifact.solver,
          quote: { outputAmount: "98000000" },
        },
        proofExplorer: happyArtifact.terminalExplorer,
        proofKind: "happy",
      },
      {
        requestId: "devnet-timeout",
        status: "refunded",
        createdAt: timeoutArtifact.submitIntentSignature,
        quoteDeadlineAt: timeoutArtifact.submitBidSignature,
        inputAmount: "100000000",
        minOutputAmount: "95000000",
        integrator: "judge-demo",
        quotes: [
          {
            quoteId: timeoutArtifact.winningBid,
            solverId: timeoutArtifact.solver,
            outputAmount: "98000000",
            validUntil: timeoutArtifact.terminalSignature,
          },
        ],
        selectedQuoteId: timeoutArtifact.winningBid,
        executionPlan: {
          selectedSolverId: timeoutArtifact.solver,
          quote: { outputAmount: "98000000" },
        },
        proofExplorer: timeoutArtifact.terminalExplorer,
        proofKind: "timeout",
      },
    ],
    []
  );

  useEffect(() => {
    if (mode === "seeded") {
      setRequests(seededRequests);
      setSelectedRequest(seededRequests[0]);
      setRelayHealth("unknown");
      return;
    }

    let cancelled = false;

    async function refresh() {
      try {
        const [healthResponse, requestsResponse] = await Promise.all([
          fetch(`${RELAY_BASE}/health`),
          fetch(`${RELAY_BASE}/quote-requests`),
        ]);

        if (!healthResponse.ok || !requestsResponse.ok) {
          throw new Error("relay_unavailable");
        }

        const requestPayload = await requestsResponse.json();
        if (cancelled) return;

        setRelayHealth("live");
        setRequests(requestPayload.requests);
        setSelectedRequest((current) => {
          if (!requestPayload.requests.length) return null;
          if (!current) return requestPayload.requests[0];
          return (
            requestPayload.requests.find(
              (request: RelayRequest) => request.requestId === current.requestId
            ) ?? requestPayload.requests[0]
          );
        });
      } catch {
        if (cancelled) return;
        setRelayHealth("down");
        setRequests([]);
        setSelectedRequest(null);
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mode, seededRequests]);

  async function handleCreateRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode !== "live") {
      setError("Quote creation is disabled in Seeded Judge Mode.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${RELAY_BASE}/quote-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inputMint: formState.inputMint,
          outputMint: formState.outputMint,
          inputAmount: formState.inputAmount,
          minOutputAmount: formState.minOutputAmount,
          integrator: formState.integrator || null,
          callbackUrl: formState.callbackUrl || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "failed_to_create_request");
      }

      const statusResponse = await fetch(`${RELAY_BASE}/status/${payload.requestId}`);
      const statusPayload = await statusResponse.json();
      setRequests((current) => [statusPayload, ...current]);
      setSelectedRequest(statusPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "unknown_error");
    } finally {
      setIsSubmitting(false);
    }
  }

  const comparison = buildProtectedComparison(selectedRequest);

  return (
    <div className="app">
      <section className="hero" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,12,11,0.52), rgba(8,12,11,0.88)), url(${HERO_IMAGE})` }}>
        <div className="hero-top">
          <div>
            <p className="eyebrow">Flint Console</p>
            <h1>Show why Flint gives users a better protected route.</h1>
            <p className="hero-copy">
              Registered solvers, accountable execution, timeout-safe recovery, and measurable
              improvement over a baseline route.
            </p>
          </div>
          <div className="mode-switch">
            <button
              className={mode === "seeded" ? "toggle active" : "toggle"}
              onClick={() => setMode("seeded")}
            >
              Seeded Judge Mode
            </button>
            <button
              className={mode === "live" ? "toggle active" : "toggle"}
              onClick={() => setMode("live")}
            >
              Live Relay Mode
            </button>
            <span className={`health ${relayHealth}`}>relay {relayHealth}</span>
          </div>
        </div>

        <div className="hero-ribbon">
          <div>
            <span>Devnet Proof</span>
            <strong>{deployArtifact.programId.slice(0, 6)}…{deployArtifact.programId.slice(-6)}</strong>
          </div>
          <div>
            <span>Protected Improvement</span>
            <strong>+{benchmarkByName["two-solver-competition"].improvementBps} bps</strong>
          </div>
          <div>
            <span>Fallback Result</span>
            <strong>Funds recovered</strong>
          </div>
        </div>
      </section>

      <section className="compare-board">
        <div className="board-head">
          <div>
            <p className="eyebrow">Protected Swap View</p>
            <h2>One screen that explains the value.</h2>
          </div>
          <p className="board-copy">
            This is the end-user effect of Flint’s backend: compare a baseline route against a
            solver-selected protected route, and show what happens when execution fails.
          </p>
        </div>

        <div className="compare-grid">
          <div className="route-column baseline">
            <span className="column-label">Baseline Route</span>
            <strong>{comparison.baseline}</strong>
            <p>Single solver or minimum acceptable outcome.</p>
          </div>
          <div className="route-center">
            <span className="delta">{comparison.delta}</span>
            <p>{comparison.tagline}</p>
          </div>
          <div className="route-column protected">
            <span className="column-label">Flint Protected</span>
            <strong>{comparison.protected}</strong>
            <p>{comparison.note}</p>
          </div>
        </div>
      </section>

      <main className="workspace">
        <section className="workspace-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Quote Request</p>
              <h2>What an integrator actually sends.</h2>
            </div>
            <p>
              This is the B2B surface. Wallets, agents, and apps do not need to know Flint’s
              internal auction lifecycle to request protected execution.
            </p>
          </div>

          <form className="request-grid" onSubmit={handleCreateRequest}>
            <LabelField label="Input Mint">
              <input
                value={formState.inputMint}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, inputMint: event.target.value }))
                }
              />
            </LabelField>
            <LabelField label="Output Mint">
              <input
                value={formState.outputMint}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, outputMint: event.target.value }))
                }
              />
            </LabelField>
            <LabelField label="Input Amount">
              <input
                value={formState.inputAmount}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, inputAmount: event.target.value }))
                }
              />
            </LabelField>
            <LabelField label="Min Output">
              <input
                value={formState.minOutputAmount}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, minOutputAmount: event.target.value }))
                }
              />
            </LabelField>
            <LabelField label="Integrator">
              <input
                value={formState.integrator}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, integrator: event.target.value }))
                }
              />
            </LabelField>
            <LabelField label="Callback URL">
              <input
                value={formState.callbackUrl}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, callbackUrl: event.target.value }))
                }
              />
            </LabelField>
            <div className="request-actions">
              <button className="action-button" disabled={mode !== "live" || isSubmitting}>
                {isSubmitting ? "Creating…" : "Create Quote Request"}
              </button>
              {error ? <p className="error">{error}</p> : null}
            </div>
          </form>
        </section>

        <section className="workspace-band monitor-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Execution Monitor</p>
              <h2>Request lifecycle, not just a router quote.</h2>
            </div>
            <p>
              Flint wins when a judge can see the request move from creation to quote competition to
              settle or refund, with proof links attached.
            </p>
          </div>

          <div className="monitor-grid">
            <div className="request-stream">
              {requests.length ? (
                requests.map((request) => (
                  <button
                    key={request.requestId}
                    className={
                      selectedRequest?.requestId === request.requestId
                        ? "stream-row active"
                        : "stream-row"
                    }
                    onClick={() => setSelectedRequest(request)}
                  >
                    <div>
                      <strong>{request.requestId}</strong>
                      <span>{request.integrator ?? "direct request"}</span>
                    </div>
                    <span className={`status-chip ${request.status}`}>{request.status}</span>
                  </button>
                ))
              ) : (
                <div className="empty">No requests loaded.</div>
              )}
            </div>

            <div className="request-panel">
              {selectedRequest ? (
                <>
                  <Lifecycle request={selectedRequest} />

                  <div className="detail-strip">
                    <Metric label="Quotes" value={String(selectedRequest.quotes?.length ?? 0)} />
                    <Metric
                      label="Selected Solver"
                      value={selectedRequest.executionPlan?.selectedSolverId ?? "Pending"}
                    />
                    <Metric
                      label="Selected Output"
                      value={
                        selectedRequest.executionPlan?.quote?.outputAmount
                          ? formatAmount(selectedRequest.executionPlan.quote.outputAmount)
                          : "Pending"
                      }
                    />
                    <Metric
                      label="Deadline"
                      value={selectedRequest.quoteDeadlineAt ?? "Unknown"}
                    />
                  </div>

                  <div className="proof-links">
                    {selectedRequest.proofExplorer ? (
                      <a href={selectedRequest.proofExplorer} target="_blank" rel="noreferrer">
                        Open terminal tx on explorer
                      </a>
                    ) : (
                      <span>Live relay requests produce proof once execution is attached.</span>
                    )}
                  </div>

                  <div className="plan-table">
                    <Row label="Input amount" value={formatAmount(selectedRequest.inputAmount)} />
                    <Row label="Min output" value={formatAmount(selectedRequest.minOutputAmount)} />
                    <Row
                      label="Quote validity"
                      value={
                        selectedRequest.quotes?.[0]?.validUntil ?? selectedRequest.quoteDeadlineAt ?? "Unknown"
                      }
                    />
                    <Row
                      label="Terminal path"
                      value={selectedRequest.proofKind === "timeout" ? "refund_after_timeout" : "settle_auction"}
                    />
                  </div>
                </>
              ) : (
                <div className="empty">Choose a request to inspect its lifecycle.</div>
              )}
            </div>
          </div>
        </section>

        <section className="workspace-band proof-band">
          <div className="band-header">
            <div>
              <p className="eyebrow">Proof and Benchmarks</p>
              <h2>Why Flint is bigger than a one-off demo.</h2>
            </div>
            <p>
              The product shell has to prove two things at once: users can get a better outcome on
              hard trades, and they are safer when execution breaks.
            </p>
          </div>

          <div className="proof-layout">
            <div className="proof-table">
              <ProofRow
                title="Single solver baseline"
                baseline="95,000,000"
                result="96,000,000"
                impact="+105 bps"
              />
              <ProofRow
                title="Two solver competition"
                baseline="95,000,000"
                result="98,000,000"
                impact="+315 bps"
              />
              <ProofRow
                title="Timeout recovery"
                baseline="Winning bid goes stale"
                result="100,000,000 refunded input"
                impact="Funds recovered"
              />
            </div>

            <div className="proof-visual">
              <img src={PROOF_IMAGE} alt="Operators reviewing benchmark and execution data." />
              <div className="proof-caption">
                <strong>Judge-facing reading:</strong>
                <span>
                  Flint is a protected execution mode for wallets and agents, not a generic DEX UI.
                </span>
              </div>
            </div>
          </div>

          <div className="api-strip">
            <span>POST /quote-request</span>
            <span>POST /solver/quote</span>
            <span>POST /execute</span>
            <span>GET /status/:requestId</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function buildProtectedComparison(request: RelayRequest | null) {
  const baselineOutput = benchmarkByName["single-solver-baseline"].winningOutput ?? "0";
  const protectedQuotedOutput =
    request?.executionPlan?.quote?.outputAmount ??
    benchmarkByName["two-solver-competition"].winningOutput ??
    "0";

  const baselineRaw = BigInt(baselineOutput);
  const protectedRaw = BigInt(protectedQuotedOutput);
  const delta = protectedRaw - baselineRaw;
  const deltaBps = baselineRaw > 0n ? Number((delta * 10_000n) / baselineRaw) : 0;

  if (request?.status === "refunded") {
    return {
      baseline: "No fallback guarantee",
      protected: "100,000,000 input returned",
      delta: "Safety preserved",
      tagline: "Flint protects users when the selected solver does not complete execution.",
      note: "Fallback-safe lifecycle matters as much as price improvement.",
    };
  }

  return {
    baseline: `${formatAmount(baselineOutput)} output`,
    protected: `${formatAmount(protectedQuotedOutput)} output`,
    delta: `+${deltaBps} bps vs baseline`,
    tagline: "Protected execution exposes user-visible upside, not only backend discipline.",
    note: "More competition, same lifecycle guarantees.",
  };
}

function formatAmount(value?: string) {
  if (!value) return "—";
  return Number(value).toLocaleString();
}

function LabelField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Lifecycle({ request }: { request: RelayRequest }) {
  const steps = [
    ["created", true],
    ["quotes received", (request.quotes?.length ?? 0) > 0],
    ["solver selected", Boolean(request.selectedQuoteId)],
    ["execution plan", Boolean(request.executionPlan)],
    [request.status === "refunded" ? "refunded" : "settled / selected", ["executed", "selected", "refunded"].includes(request.status)],
  ] as const;

  return (
    <div className="lifecycle">
      {steps.map(([label, active]) => (
        <div key={label} className={active ? "lifecycle-step active" : "lifecycle-step"}>
          <span className="dot" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProofRow({
  title,
  baseline,
  result,
  impact,
}: {
  title: string;
  baseline: string;
  result: string;
  impact: string;
}) {
  return (
    <div className="proof-row">
      <div>
        <strong>{title}</strong>
        <span>{baseline}</span>
      </div>
      <div>
        <strong>{result}</strong>
        <span>{impact}</span>
      </div>
    </div>
  );
}

export default App;
