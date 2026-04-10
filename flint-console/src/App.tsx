import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import deployArtifact from "../../artifacts/devnet-deploy.json";
import benchmarkArtifact from "../../artifacts/benchmark-local.json";
import sampleQuoteResponse from "../../artifacts/sample-selected-quote-response.json";
import sampleWebhook from "../../artifacts/sample-webhook-payload.json";
import happyArtifact from "../../artifacts/devnet-smoke-happy.json";
import timeoutArtifact from "../../artifacts/devnet-smoke-timeout.json";
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
  executionResult?: Record<string, unknown> | null;
};

type SolverSummary = {
  id: string;
  label: string;
  stake: string;
  reputation: number;
  settleRate: number;
  timeoutRate: number;
  activeExposure: string;
  quoteCount: number;
};

type AnalyticsSummary = {
  totalRequests: number;
  settlementRate: number;
  timeoutRate: number;
  avgImprovementBps: number;
  quoteCount: number;
  benchmark: {
    singleSolverBaselineBps: number;
    twoSolverCompetitionBps: number;
    timeoutRecovery: boolean;
  };
};

type RequestStatus =
  | "LIVE"
  | "SETTLING"
  | "SETTLED"
  | "REFUNDED"
  | "CANCELLED"
  | "SLASHED"
  | "STUCK";

type IntentRow = {
  id: string;
  pair: string;
  amountLabel: string;
  status: RequestStatus;
  resultLabel: string;
  resultTone: "positive" | "neutral" | "warning" | "negative";
  auctionLabel: string;
  auctionProgress: number | null;
  selectedSolver: string;
  improvementBps: number | null;
  proofExplorer: string | null;
  createdAt: string | null;
  quoteDeadlineAt: string | null;
  raw: RelayRequest;
};

type Tab = "requests" | "solvers" | "analytics" | "api" | "settings";
type Profile = "live" | "judge";

const RELAY_BASE =
  (import.meta.env.VITE_FLINT_RELAY_BASE as string | undefined) ?? "http://127.0.0.1:8787";
const PROFILE_DEFAULT =
  (import.meta.env.VITE_CONSOLE_PROFILE as Profile | undefined) ?? "live";
const NETWORK =
  (import.meta.env.VITE_CONSOLE_NETWORK as string | undefined) ?? "Devnet";
const OPERATOR_LABEL =
  (import.meta.env.VITE_CONSOLE_OPERATOR as string | undefined) ?? "Operator";
const PROGRAM_ID = deployArtifact.programId;
const REQUEST_STATUS_ORDER: RequestStatus[] = [
  "LIVE",
  "SETTLING",
  "SETTLED",
  "REFUNDED",
  "SLASHED",
  "CANCELLED",
  "STUCK",
];

const TOKEN_OPTIONS = [
  { symbol: "SOL", mint: "So11111111111111111111111111111111111111112" },
  { symbol: "USDC", mint: "USDC111111111111111111111111111111111111111" },
  { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6Xc5x6sJvtJ6a8wX" },
];

const benchmarkByName = benchmarkArtifact.scenarios.reduce<
  Record<string, (typeof benchmarkArtifact.scenarios)[number]>
>((acc, scenario) => {
  acc[scenario.name] = scenario;
  return acc;
}, {});

const SEEDED_SOLVERS: SolverSummary[] = [
  {
    id: "solver-alpha",
    label: "solver-alpha",
    stake: "100 SOL",
    reputation: 99,
    settleRate: 100,
    timeoutRate: 0,
    activeExposure: "0",
    quoteCount: 1,
  },
  {
    id: "solver-timeout",
    label: "solver-timeout",
    stake: "80 SOL",
    reputation: 78,
    settleRate: 0,
    timeoutRate: 100,
    activeExposure: "0",
    quoteCount: 1,
  },
];

const SEEDED_ANALYTICS: AnalyticsSummary = {
  totalRequests: 2,
  settlementRate: 50,
  timeoutRate: 50,
  avgImprovementBps: benchmarkByName["two-solver-competition"].improvementBps ?? 0,
  quoteCount: 2,
  benchmark: {
    singleSolverBaselineBps: benchmarkByName["single-solver-baseline"].improvementBps ?? 0,
    twoSolverCompetitionBps: benchmarkByName["two-solver-competition"].improvementBps ?? 0,
    timeoutRecovery: true,
  },
};

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("requests");
  const [relayHealth, setRelayHealth] = useState<"unknown" | "live" | "down">("unknown");
  const [requests, setRequests] = useState<IntentRow[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<IntentRow | null>(null);
  const [solvers, setSolvers] = useState<SolverSummary[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const profile = resolveProfile();

  useEffect(() => {
    if (profile === "judge") {
      const seededRows = buildJudgeSeededRows();
      setRequests(seededRows);
      setSelectedRequest(seededRows[0] ?? null);
      setSolvers(SEEDED_SOLVERS);
      setAnalytics(SEEDED_ANALYTICS);
      setRelayHealth("unknown");
      return;
    }

    let cancelled = false;

    async function refresh() {
      try {
        const [healthResponse, requestsResponse, solversResponse, analyticsResponse] =
          await Promise.all([
            fetch(`${RELAY_BASE}/health`),
            fetch(`${RELAY_BASE}/quote-requests`),
            fetch(`${RELAY_BASE}/solvers`),
            fetch(`${RELAY_BASE}/analytics/summary`),
          ]);

        if (
          !healthResponse.ok ||
          !requestsResponse.ok ||
          !solversResponse.ok ||
          !analyticsResponse.ok
        ) {
          throw new Error("relay_unavailable");
        }

        const requestsPayload = await requestsResponse.json();
        const solversPayload = await solversResponse.json();
        const analyticsPayload = await analyticsResponse.json();

        if (cancelled) return;

        const liveRows = normalizeRequests(requestsPayload.requests);
        setRelayHealth("live");
        setRequests(liveRows);
        setSolvers(solversPayload.solvers);
        setAnalytics(analyticsPayload);
        setSelectedRequest((current) => {
          if (!liveRows.length) return null;
          if (!current) return liveRows[0];
          return liveRows.find((request) => request.id === current.id) ?? liveRows[0];
        });
      } catch {
        if (cancelled) return;
        setRelayHealth("down");
        setRequests([]);
        setSolvers([]);
        setAnalytics(null);
        setSelectedRequest(null);
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [profile]);

  return (
    <div className="shell">
      <TopBar relayHealth={relayHealth} />
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="shell-main">
        {activeTab === "requests" && (
          <>
            <section className="panel requests-panel">
              <RequestsHeader
                relayHealth={relayHealth}
                onSubmitIntent={() => setShowSubmitModal(true)}
              />
              <RequestsTable
                rows={requests}
                selectedRequestId={selectedRequest?.id ?? null}
                onSelect={(row) => setSelectedRequest(row)}
              />
            </section>

            {selectedRequest ? (
              <RequestDrawer request={selectedRequest} onClose={() => setSelectedRequest(null)} />
            ) : null}
          </>
        )}

        {activeTab === "solvers" && (
          <section className="panel">
            <SectionHeader
              title="Solvers"
              subtitle="Registered counterparties and execution quality indicators."
            />
            <SolversTable solvers={solvers} />
          </section>
        )}

        {activeTab === "analytics" && (
          <section className="panel">
            <SectionHeader
              title="Analytics"
              subtitle="Operational rates, benchmark references, and proof summaries."
            />
            <AnalyticsView analytics={analytics ?? SEEDED_ANALYTICS} />
          </section>
        )}

        {activeTab === "api" && (
          <section className="panel">
            <SectionHeader
              title="API"
              subtitle="Relay surface, SDK, and payload examples."
            />
            <ApiView />
          </section>
        )}

        {activeTab === "settings" && (
          <section className="panel">
            <SectionHeader
              title="Settings"
              subtitle="Relay and environment details."
            />
            <SettingsView profile={profile} />
          </section>
        )}
      </main>

      {showSubmitModal ? (
        <SubmitIntentModal
          onClose={() => setShowSubmitModal(false)}
          onCreated={(request) => {
            const normalized = normalizeRequest(request);
            setRequests((current) => [normalized, ...current]);
            setSelectedRequest(normalized);
            setShowSubmitModal(false);
          }}
          profile={profile}
        />
      ) : null}
    </div>
  );
}

function resolveProfile(): Profile {
  const query = new URLSearchParams(window.location.search).get("profile");
  if (query === "judge" || query === "live") {
    return query;
  }
  return PROFILE_DEFAULT;
}

function buildJudgeSeededRows(): IntentRow[] {
  const happyRequest: RelayRequest = {
    requestId: "devnet-happy",
    status: "executed",
    createdAt: happyArtifact.submitIntentSignature,
    quoteDeadlineAt: happyArtifact.submitBidSignature,
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "USDC111111111111111111111111111111111111111",
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
    executionResult: { signature: happyArtifact.terminalSignature },
  };

  const timeoutRequest: RelayRequest = {
    requestId: "devnet-timeout",
    status: "refunded",
    createdAt: timeoutArtifact.submitIntentSignature,
    quoteDeadlineAt: timeoutArtifact.submitBidSignature,
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "USDC111111111111111111111111111111111111111",
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
    executionResult: { refundSignature: timeoutArtifact.terminalSignature },
  };

  return normalizeRequests([happyRequest, timeoutRequest]);
}

function normalizeRequests(requests: RelayRequest[]): IntentRow[] {
  return requests.map(normalizeRequest).sort(sortRequests);
}

function normalizeRequest(request: RelayRequest): IntentRow {
  const inputSymbol = request.inputMint ? symbolForMint(request.inputMint) : "UNK";
  const outputSymbol = request.outputMint ? symbolForMint(request.outputMint) : "UNK";
  const status = statusForRequest(request.status ?? "open", request);
  const selectedOutput = request.executionPlan?.quote?.outputAmount;
  const minOutput = request.minOutputAmount;
  const improvementBps =
    selectedOutput && minOutput ? calcImprovementBps(selectedOutput, minOutput) : null;

  return {
    id: request.requestId,
    pair: `${inputSymbol} → ${outputSymbol}`,
    amountLabel: formatAmount(request.inputAmount, inputSymbol),
    status,
    resultLabel: buildResultLabel(status, improvementBps),
    resultTone: resultToneForStatus(status),
    auctionLabel: buildAuctionLabel(status, request.quoteDeadlineAt),
    auctionProgress: buildAuctionProgress(status, request.createdAt, request.quoteDeadlineAt),
    selectedSolver: request.executionPlan?.selectedSolverId ?? "pending",
    improvementBps,
    proofExplorer: buildProofExplorer(status, request),
    createdAt: request.createdAt ?? null,
    quoteDeadlineAt: request.quoteDeadlineAt ?? null,
    raw: request,
  };
}

function sortRequests(a: IntentRow, b: IntentRow) {
  const aRank = REQUEST_STATUS_ORDER.indexOf(a.status);
  const bRank = REQUEST_STATUS_ORDER.indexOf(b.status);
  if (aRank !== bRank) return aRank - bRank;
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

function symbolForMint(mint: string) {
  const token = TOKEN_OPTIONS.find((item) => item.mint === mint);
  return token?.symbol ?? mint.slice(0, 4);
}

function formatAmount(value?: string, symbol?: string) {
  if (!value) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return symbol ? `${value} ${symbol}` : value;
  return symbol ? `${numeric.toLocaleString()} ${symbol}` : numeric.toLocaleString();
}

function calcImprovementBps(outputAmount: string, minOutputAmount: string) {
  const selected = BigInt(outputAmount);
  const min = BigInt(minOutputAmount);
  if (min === 0n) return 0;
  return Number(((selected - min) * 10_000n) / min);
}

function statusForRequest(rawStatus: string, request: RelayRequest): RequestStatus {
  if (rawStatus === "executed") return "SETTLED";
  if (rawStatus === "refunded") return "REFUNDED";
  if (rawStatus === "cancelled") return "CANCELLED";
  if (rawStatus === "slashed") return "SLASHED";
  if (rawStatus === "selected") return "SETTLING";
  if (rawStatus === "quoted" || rawStatus === "open") {
    return request.quotes?.length ? "LIVE" : "STUCK";
  }
  return "STUCK";
}

function buildResultLabel(status: RequestStatus, improvementBps: number | null) {
  switch (status) {
    case "SETTLED":
      return improvementBps != null ? `+${improvementBps} bps` : "settled";
    case "REFUNDED":
      return "funds recovered";
    case "SLASHED":
      return "slashed";
    case "CANCELLED":
      return "no bids";
    case "SETTLING":
      return "executing";
    case "LIVE":
      return improvementBps != null ? `+${improvementBps} bps` : "best quote live";
    case "STUCK":
      return "grace not met";
    default:
      return "—";
  }
}

function resultToneForStatus(status: RequestStatus) {
  switch (status) {
    case "SETTLED":
    case "LIVE":
      return "positive";
    case "REFUNDED":
      return "warning";
    case "SLASHED":
      return "negative";
    default:
      return "neutral";
  }
}

function buildAuctionLabel(status: RequestStatus, deadline?: string) {
  if (status !== "LIVE" && status !== "STUCK") {
    return "closed";
  }
  if (!deadline) return "unknown";
  const diffSeconds = Math.max(
    0,
    Math.round((new Date(deadline).getTime() - Date.now()) / 1000)
  );
  return `${diffSeconds}s`;
}

function buildAuctionProgress(status: RequestStatus, createdAt?: string, deadline?: string) {
  if (status !== "LIVE" || !createdAt || !deadline) return null;
  const start = new Date(createdAt).getTime();
  const end = new Date(deadline).getTime();
  if (end <= start) return 0;
  const progress = ((Date.now() - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, progress));
}

function buildProofExplorer(status: RequestStatus, request: RelayRequest) {
  const signature =
    status === "SETTLED"
      ? request.executionResult?.signature
      : status === "REFUNDED"
        ? request.executionResult?.refundSignature
        : null;
  return typeof signature === "string"
    ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    : null;
}

function TopBar({ relayHealth }: { relayHealth: "unknown" | "live" | "down" }) {
  return (
    <header className="topbar">
      <div className="brand">FLINT</div>
      <div className="topbar-right">
        <span className={`status-pill ${relayHealth}`}>relay {relayHealth}</span>
        <span className="status-pill">{NETWORK}</span>
        <span className="status-pill">{OPERATOR_LABEL}</span>
      </div>
    </header>
  );
}

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}) {
  const tabs: Tab[] = ["requests", "solvers", "analytics", "api", "settings"];

  return (
    <nav className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={activeTab === tab ? "tab active" : "tab"}
          onClick={() => onTabChange(tab)}
        >
          {capitalize(tab)}
        </button>
      ))}
    </nav>
  );
}

function RequestsHeader({
  onSubmitIntent,
  relayHealth,
}: {
  onSubmitIntent: () => void;
  relayHealth: "unknown" | "live" | "down";
}) {
  return (
    <div className="requests-header">
      <div className="filters">
        {REQUEST_STATUS_ORDER.map((status) => (
          <span key={status} className={`filter-chip ${status.toLowerCase()}`}>
            {status}
          </span>
        ))}
      </div>
      <div className="requests-actions">
        <span className="subtle-text">
          {relayHealth === "live" ? "Live refresh" : "Relay offline fallback"}
        </span>
        <button className="primary-button" onClick={onSubmitIntent}>
          + Submit Intent
        </button>
      </div>
    </div>
  );
}

function RequestsTable({
  rows,
  selectedRequestId,
  onSelect,
}: {
  rows: IntentRow[];
  selectedRequestId: string | null;
  onSelect: (row: IntentRow) => void;
}) {
  return (
    <div className="table-shell">
      <table className="ledger">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Result</th>
            <th>Auction</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row) => (
              <tr
                key={row.id}
                className={selectedRequestId === row.id ? "selected" : undefined}
                onClick={() => onSelect(row)}
              >
                <td>{row.pair}</td>
                <td className="mono">{row.amountLabel}</td>
                <td>
                  <span className={`status-tag ${row.status.toLowerCase()}`}>{row.status}</span>
                </td>
                <td>
                  <span className={`result-tag ${row.resultTone}`}>{row.resultLabel}</span>
                </td>
                <td>
                  {row.auctionProgress != null ? (
                    <div className="auction-cell">
                      <span className="mono">{row.auctionLabel}</span>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${row.auctionProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="subtle-text">{row.auctionLabel}</span>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>
                <div className="empty-state">No requests in the ledger yet.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RequestDrawer({
  request,
  onClose,
}: {
  request: IntentRow;
  onClose: () => void;
}) {
  const quotes = request.raw.quotes ?? [];
  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div>
          <div className="drawer-id">{request.id}</div>
          <div className="drawer-status-row">
            <span className={`status-tag ${request.status.toLowerCase()}`}>{request.status}</span>
            <span className={`result-tag ${request.resultTone}`}>{request.resultLabel}</span>
          </div>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close drawer">
          ×
        </button>
      </div>

      <div className="drawer-section">
        <span className="section-kicker">Lifecycle</span>
        <div className="lifecycle">
          {buildLifecycle(request).map((item) => (
            <div key={item.label} className="lifecycle-row">
              <span className={`lifecycle-dot ${item.active ? "active" : ""}`} />
              <span>{item.label}</span>
              <span className="subtle-text">{item.meta ?? "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="drawer-section">
        <span className="section-kicker">Trade</span>
        <DrawerRow label="Pair" value={request.pair} />
        <DrawerRow label="Input" value={request.amountLabel} mono />
        <DrawerRow
          label="Min output"
          value={formatAmount(request.raw.minOutputAmount, symbolForMint(request.raw.outputMint ?? ""))}
          mono
        />
        <DrawerRow
          label="Selected output"
          value={
            request.raw.executionPlan?.quote?.outputAmount
              ? formatAmount(
                  request.raw.executionPlan.quote.outputAmount,
                  symbolForMint(request.raw.outputMint ?? "")
                )
              : "Pending"
          }
          mono
        />
        <DrawerRow
          label="Improvement"
          value={request.improvementBps != null ? `+${request.improvementBps} bps` : "—"}
          mono
        />
      </div>

      <div className="drawer-section">
        <span className="section-kicker">Bid history</span>
        <div className="quote-list">
          {quotes.length ? (
            quotes.map((quote) => (
              <div key={quote.quoteId} className="quote-row">
                <span>{quote.solverId}</span>
                <span className="mono">{formatAmount(quote.outputAmount)}</span>
              </div>
            ))
          ) : (
            <div className="empty-inline">No quotes received.</div>
          )}
        </div>
      </div>

      <div className="drawer-section">
        <span className="section-kicker">On-chain references</span>
        <DrawerRow label="Intent" value={request.raw.requestId} mono />
        <DrawerRow label="Selected solver" value={request.selectedSolver} mono />
        <DrawerRow
          label="Explorer"
          value={request.proofExplorer ?? "Unavailable"}
          link={request.proofExplorer ?? undefined}
        />
      </div>
    </aside>
  );
}

function buildLifecycle(request: IntentRow) {
  const quoteCount = request.raw.quotes?.length ?? 0;
  return [
    { label: "created", active: true, meta: request.createdAt ?? undefined },
    { label: "quotes received", active: quoteCount > 0, meta: quoteCount ? `${quoteCount} quotes` : undefined },
    {
      label: "solver selected",
      active: Boolean(request.raw.selectedQuoteId),
      meta: request.selectedSolver !== "pending" ? request.selectedSolver : undefined,
    },
    {
      label: "execution plan",
      active: Boolean(request.raw.executionPlan),
      meta: request.raw.executionPlan ? "ready" : undefined,
    },
    {
      label: request.status === "REFUNDED" ? "refunded" : request.status === "SETTLED" ? "settled" : request.status.toLowerCase(),
      active: ["SETTLED", "REFUNDED", "SLASHED", "CANCELLED"].includes(request.status),
      meta: request.proofExplorer ? "on-chain verified" : undefined,
    },
  ];
}

function DrawerRow({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  link?: string;
}) {
  return (
    <div className="drawer-row">
      <span className="subtle-text">{label}</span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className={mono ? "mono" : undefined}>
          {value}
        </a>
      ) : (
        <strong className={mono ? "mono" : undefined}>{value}</strong>
      )}
    </div>
  );
}

function SolversTable({ solvers }: { solvers: SolverSummary[] }) {
  return (
    <div className="table-shell">
      <table className="ledger">
        <thead>
          <tr>
            <th>Solver</th>
            <th>Stake</th>
            <th>Reputation</th>
            <th>Settle Rate</th>
            <th>Timeout Rate</th>
            <th>Active Exposure</th>
          </tr>
        </thead>
        <tbody>
          {solvers.length ? (
            solvers.map((solver) => (
              <tr key={solver.id}>
                <td>{solver.label}</td>
                <td className="mono">{solver.stake}</td>
                <td>{solver.reputation}</td>
                <td>{solver.settleRate}%</td>
                <td>{solver.timeoutRate}%</td>
                <td className="mono">{solver.activeExposure}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>
                <div className="empty-state">No solver summary available.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsView({ analytics }: { analytics: AnalyticsSummary }) {
  return (
    <div className="analytics-grid">
      <MetricCard label="Total requests" value={String(analytics.totalRequests)} />
      <MetricCard label="Settlement rate" value={`${analytics.settlementRate}%`} />
      <MetricCard label="Timeout rate" value={`${analytics.timeoutRate}%`} />
      <MetricCard label="Avg improvement" value={`+${analytics.avgImprovementBps} bps`} />
      <MetricCard label="Single solver baseline" value={`+${analytics.benchmark.singleSolverBaselineBps} bps`} />
      <MetricCard label="Two solver competition" value={`+${analytics.benchmark.twoSolverCompetitionBps} bps`} />
      <MetricCard
        label="Timeout recovery"
        value={analytics.benchmark.timeoutRecovery ? "Funds recovered" : "Unknown"}
      />
    </div>
  );
}

function ApiView() {
  return (
    <div className="api-grid">
      <MetricCard label="Relay URL" value={RELAY_BASE} mono />
      <MetricCard label="Program" value={PROGRAM_ID} mono />
      <div className="code-panel">
        <h3>Relay endpoints</h3>
        <ul>
          <li className="mono">GET /health</li>
          <li className="mono">GET /quote-requests</li>
          <li className="mono">GET /status/:requestId</li>
          <li className="mono">GET /solvers</li>
          <li className="mono">GET /analytics/summary</li>
          <li className="mono">POST /quote-request</li>
          <li className="mono">POST /solver/quote</li>
          <li className="mono">POST /execute</li>
        </ul>
      </div>
      <CodeBlock title="Selected quote response" value={sampleQuoteResponse} />
      <CodeBlock title="Webhook payload" value={sampleWebhook} />
      <CodeBlock
        title="TypeScript SDK"
        value={{
          example: "const requests = await client.listQuoteRequests();",
        }}
      />
    </div>
  );
}

function SettingsView({ profile }: { profile: Profile }) {
  return (
    <div className="settings-grid">
      <MetricCard label="Profile" value={profile} />
      <MetricCard label="Network" value={NETWORK} />
      <MetricCard label="Relay URL" value={RELAY_BASE} mono />
      <MetricCard label="Operator" value={OPERATOR_LABEL} />
      <MetricCard label="Program ID" value={PROGRAM_ID} mono />
    </div>
  );
}

function SubmitIntentModal({
  onClose,
  onCreated,
  profile,
}: {
  onClose: () => void;
  onCreated: (request: RelayRequest) => void;
  profile: Profile;
}) {
  const [formState, setFormState] = useState({
    inputMint: TOKEN_OPTIONS[0].mint,
    outputMint: TOKEN_OPTIONS[1].mint,
    inputAmount: "1000000",
    minOutputAmount: "990000",
    integrator: "flint-console",
    callbackUrl: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profile === "judge") {
      setError("Submit Intent is hidden in judge profile.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${RELAY_BASE}/quote-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formState),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "failed_to_create_request");
      }
      const statusResponse = await fetch(`${RELAY_BASE}/status/${payload.requestId}`);
      const request = await statusResponse.json();
      onCreated(request);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "unknown_error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Submit Intent</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </div>

        <form className="modal-grid" onSubmit={handleSubmit}>
          <TokenField
            label="Input token"
            value={formState.inputMint}
            onChange={(value) => setFormState((current) => ({ ...current, inputMint: value }))}
          />
          <TokenField
            label="Output token"
            value={formState.outputMint}
            onChange={(value) => setFormState((current) => ({ ...current, outputMint: value }))}
          />
          <TextField
            label="Input amount"
            value={formState.inputAmount}
            onChange={(value) => setFormState((current) => ({ ...current, inputAmount: value }))}
          />
          <TextField
            label="Min output"
            value={formState.minOutputAmount}
            onChange={(value) =>
              setFormState((current) => ({ ...current, minOutputAmount: value }))
            }
          />
          <TextField
            label="Integrator"
            value={formState.integrator}
            onChange={(value) => setFormState((current) => ({ ...current, integrator: value }))}
          />
          <TextField
            label="Callback URL"
            value={formState.callbackUrl}
            onChange={(value) => setFormState((current) => ({ ...current, callbackUrl: value }))}
          />

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </div>
    </div>
  );
}

function TokenField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {TOKEN_OPTIONS.map((token) => (
          <option key={token.mint} value={token.mint}>
            {token.symbol}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        <p className="subtle-text">{subtitle}</p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="metric-card">
      <span className="subtle-text">{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}

function CodeBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="code-panel">
      <h3>{title}</h3>
      <pre className="code-block">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default App;
