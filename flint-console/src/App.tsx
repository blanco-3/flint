import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import deployArtifact from "../../artifacts/devnet-deploy.json";
import happyArtifact from "../../artifacts/devnet-smoke-happy.json";
import timeoutArtifact from "../../artifacts/devnet-smoke-timeout.json";
import benchmarkArtifact from "../../artifacts/benchmark-local.json";
import "./index.css";

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
  quotes?: Array<{
    quoteId: string;
    solverId: string;
    outputAmount: string;
    validUntil: string;
  }>;
  selectedQuoteId?: string | null;
  executionPlan?: {
    selectedSolverId?: string;
    quote?: {
      outputAmount?: string;
    };
  } | null;
};

const RELAY_BASE = (import.meta.env.VITE_FLINT_RELAY_BASE as string | undefined) ?? "http://127.0.0.1:8787";

const benchmarkSummary = benchmarkArtifact.scenarios.reduce<Record<string, (typeof benchmarkArtifact.scenarios)[number]>>(
  (acc, scenario) => {
    acc[scenario.name] = scenario;
    return acc;
  },
  {}
);

function App() {
  const [mode, setMode] = useState<"seeded" | "live">("seeded");
  const [health, setHealth] = useState<"unknown" | "ok" | "down">("unknown");
  const [requests, setRequests] = useState<RelayRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<RelayRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
        inputAmount: "100000000",
        minOutputAmount: "95000000",
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
      },
      {
        requestId: "devnet-timeout",
        status: "refunded",
        createdAt: timeoutArtifact.submitIntentSignature,
        inputAmount: "100000000",
        minOutputAmount: "95000000",
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
      },
    ],
    []
  );

  useEffect(() => {
    if (mode === "seeded") {
      setRequests(seededRequests);
      setSelectedRequest(seededRequests[0]);
      setHealth("unknown");
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
          throw new Error("relay unavailable");
        }

        const requestPayload = await requestsResponse.json();
        if (cancelled) return;

        setHealth("ok");
        setRequests(requestPayload.requests);
        setSelectedRequest((current) => {
          if (!requestPayload.requests.length) {
            return null;
          }
          if (!current) {
            return requestPayload.requests[0];
          }
          return (
            requestPayload.requests.find(
              (request: RelayRequest) => request.requestId === current.requestId
            ) ?? requestPayload.requests[0]
          );
        });
      } catch (error) {
        if (cancelled) return;
        setHealth("down");
        setRequests([]);
        setSelectedRequest(null);
      }
    }

    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mode, seededRequests]);

  async function handleCreateRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode !== "live") {
      setErrorMessage("Quote creation is only enabled in live relay mode.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "unknown_error");
    } finally {
      setIsSubmitting(false);
    }
  }

  const comparisonCard = buildComparisonCard(selectedRequest);

  return (
    <div className="page-shell">
      <header className="hero-band">
        <div>
          <p className="eyebrow">Flint Console</p>
          <h1>Protected execution for wallets, bots, and agents.</h1>
          <p className="lede">
            Flint is not another swap app. This shell makes the protected execution backend legible:
            registered solvers, explicit fallback recovery, benchmarked improvement, and devnet proof.
          </p>
        </div>
        <div className="hero-metrics">
          <MetricCard label="Devnet Program" value={deployArtifact.programId.slice(0, 8) + "…"} />
          <MetricCard
            label="Best Improvement"
            value={`${benchmarkSummary["two-solver-competition"].improvementBps} bps`}
          />
          <MetricCard label="Fallback" value="Funds recovered" />
        </div>
      </header>

      <nav className="topbar">
        <button
          className={mode === "seeded" ? "mode-button active" : "mode-button"}
          onClick={() => setMode("seeded")}
        >
          Seeded Judge Mode
        </button>
        <button
          className={mode === "live" ? "mode-button active" : "mode-button"}
          onClick={() => setMode("live")}
        >
          Live Relay Mode
        </button>
        <span className={`health-pill ${health}`}>relay: {health}</span>
      </nav>

      <main className="content-grid">
        <section className="panel">
          <SectionTitle
            title="Overview"
            subtitle="Devnet proof, benchmark highlights, and solver-facing posture."
          />
          <div className="stack">
            <LinkRow
              label="Program Explorer"
              value={deployArtifact.programExplorer}
            />
            <LinkRow label="Deploy Tx" value={deployArtifact.deployExplorer} />
            <LinkRow
              label="Happy Path Smoke"
              value={happyArtifact.terminalExplorer}
            />
            <LinkRow
              label="Timeout Recovery Smoke"
              value={timeoutArtifact.terminalExplorer}
            />
          </div>

          <div className="mini-grid">
            <StatCard
              label="Single-solver baseline"
              value={`${benchmarkSummary["single-solver-baseline"].improvementBps} bps`}
            />
            <StatCard
              label="Two-solver competition"
              value={`${benchmarkSummary["two-solver-competition"].improvementBps} bps`}
            />
            <StatCard label="Timeout path" value="Recovered" />
          </div>

          <div className="solver-list">
            <h3>Solver proof points</h3>
            <ul>
              <li>Registered-solvers-only bid path</li>
              <li>Config-gated slash authority</li>
              <li>Timeout-safe refund and rent return</li>
              <li>Relay/API alpha for integrators</li>
            </ul>
          </div>
        </section>

        <section className="panel">
          <SectionTitle
            title="Quote Request"
            subtitle="What a wallet or agent integrator would submit to Flint Relay."
          />
          <form className="request-form" onSubmit={handleCreateRequest}>
            <Field label="Input Mint">
              <input
                value={formState.inputMint}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, inputMint: event.target.value }))
                }
              />
            </Field>
            <Field label="Output Mint">
              <input
                value={formState.outputMint}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, outputMint: event.target.value }))
                }
              />
            </Field>
            <Field label="Input Amount">
              <input
                value={formState.inputAmount}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, inputAmount: event.target.value }))
                }
              />
            </Field>
            <Field label="Min Output">
              <input
                value={formState.minOutputAmount}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, minOutputAmount: event.target.value }))
                }
              />
            </Field>
            <Field label="Integrator">
              <input
                value={formState.integrator}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, integrator: event.target.value }))
                }
              />
            </Field>
            <Field label="Callback URL (optional)">
              <input
                value={formState.callbackUrl}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, callbackUrl: event.target.value }))
                }
              />
            </Field>
            <button className="primary-button" disabled={mode !== "live" || isSubmitting}>
              {isSubmitting ? "Creating…" : "Create Quote Request"}
            </button>
            {errorMessage ? <p className="error-copy">{errorMessage}</p> : null}
          </form>
        </section>

        <section className="panel wide">
          <SectionTitle
            title="Execution Monitor"
            subtitle="Request lifecycle with selected solver, quote validity, and execution shape."
          />
          <div className="monitor-layout">
            <aside className="request-list">
              {requests.length ? (
                requests.map((request) => (
                  <button
                    key={request.requestId}
                    className={
                      selectedRequest?.requestId === request.requestId
                        ? "request-item active"
                        : "request-item"
                    }
                    onClick={() => setSelectedRequest(request)}
                  >
                    <strong>{request.requestId}</strong>
                    <span>{request.status}</span>
                  </button>
                ))
              ) : (
                <div className="empty-state">No requests loaded yet.</div>
              )}
            </aside>

            <div className="request-detail">
              {selectedRequest ? (
                <>
                  <LifecycleTimeline request={selectedRequest} />
                  <div className="detail-grid">
                    <DetailCard label="Selected Solver" value={selectedRequest.executionPlan?.selectedSolverId ?? "Pending"} />
                    <DetailCard label="Quote Deadline" value={selectedRequest.quoteDeadlineAt ?? "Unknown"} />
                    <DetailCard label="Selected Output" value={selectedRequest.executionPlan?.quote?.outputAmount ?? "Pending"} />
                    <DetailCard label="Integrator" value={selectedRequest.integrator ?? "—"} />
                  </div>
                  <pre className="json-block">
                    {JSON.stringify(selectedRequest.executionPlan ?? selectedRequest, null, 2)}
                  </pre>
                </>
              ) : (
                <div className="empty-state">Choose a request to inspect its execution lifecycle.</div>
              )}
            </div>
          </div>
        </section>

        <section className="panel wide">
          <SectionTitle
            title="Proof / Benchmarks"
            subtitle="Make the B2B backend legible: better outcomes, fallback safety, and a clear user-visible effect."
          />
          <div className="proof-grid">
            <ComparisonCard
              title="Protected Swap Comparison"
              baseline={comparisonCard.baseline}
              protectedValue={comparisonCard.protected}
              improvement={comparisonCard.improvement}
              note={comparisonCard.note}
            />
            <ComparisonCard
              title="Single Solver Baseline"
              baseline="95,000,000 min"
              protectedValue="96,000,000 output"
              improvement="+105 bps"
              note="One registered solver still beats the minimum."
            />
            <ComparisonCard
              title="Two Solver Competition"
              baseline="95,000,000 min"
              protectedValue="98,000,000 output"
              improvement="+315 bps"
              note="Competition is what users actually feel."
            />
            <ComparisonCard
              title="Timeout Recovery"
              baseline="Counterparty failure"
              protectedValue="100,000,000 input refunded"
              improvement="Funds recovered"
              note="The point is not only price. It is protected lifecycle discipline."
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function buildComparisonCard(request: RelayRequest | null) {
  const baseline = benchmarkSummary["single-solver-baseline"].winningOutput ?? "0";
  const competitiveWinningOutput =
    benchmarkSummary["two-solver-competition"].winningOutput ?? "0";
  const protectedOutput = request?.executionPlan?.quote?.outputAmount
    ? Number(request.executionPlan.quote.outputAmount).toLocaleString()
    : competitiveWinningOutput;

  const selectedOutputRaw = request?.executionPlan?.quote?.outputAmount
    ? BigInt(request.executionPlan.quote.outputAmount)
    : BigInt(competitiveWinningOutput);
  const baselineRaw = BigInt(baseline);
  const delta = selectedOutputRaw - baselineRaw;
  const bps = Number((delta * 10_000n) / baselineRaw);

  return {
    baseline: Number(baseline).toLocaleString() + " baseline output",
    protected: protectedOutput + " protected output",
    improvement: delta > 0n ? `+${bps} bps vs baseline` : "No improvement yet",
    note:
      request?.status === "refunded"
        ? "Fallback safety preserved the user result even when execution failed."
        : "Selected solver path shows the upside of protected competition over the baseline route.",
  };
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LinkRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="link-row">
      <span>{label}</span>
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    </div>
  );
}

function LifecycleTimeline({ request }: { request: RelayRequest }) {
  const steps = [
    { name: "created", active: true },
    { name: "quotes received", active: (request.quotes?.length ?? 0) > 0 },
    { name: "solver selected", active: Boolean(request.selectedQuoteId) },
    { name: "execution plan built", active: Boolean(request.executionPlan) },
    {
      name: request.status === "refunded" ? "refunded" : "settled / ready",
      active: ["executed", "selected", "refunded"].includes(request.status),
    },
  ];

  return (
    <div className="timeline">
      {steps.map((step) => (
        <div key={step.name} className={step.active ? "timeline-step active" : "timeline-step"}>
          <span className="dot" />
          <span>{step.name}</span>
        </div>
      ))}
    </div>
  );
}

function ComparisonCard({
  title,
  baseline,
  protectedValue,
  improvement,
  note,
}: {
  title: string;
  baseline: string;
  protectedValue: string;
  improvement: string;
  note: string;
}) {
  return (
    <div className="comparison-card">
      <h3>{title}</h3>
      <div className="comparison-values">
        <div>
          <span>Baseline</span>
          <strong>{baseline}</strong>
        </div>
        <div>
          <span>Flint Protected</span>
          <strong>{protectedValue}</strong>
        </div>
      </div>
      <p className="improvement">{improvement}</p>
      <p className="note">{note}</p>
    </div>
  );
}

export default App;
