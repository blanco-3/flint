import { useEffect, useMemo, useState } from "react";
import "./index.css";

import deployArtifact from "../../artifacts/devnet-deploy.json";
import happyArtifact from "../../artifacts/devnet-smoke-happy.json";
import timeoutArtifact from "../../artifacts/devnet-smoke-timeout.json";
import benchmarkArtifact from "../../artifacts/benchmark-local.json";

// ===== TYPES =====
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
  settlementTx?: string;
  refundTx?: string;
  slashTx?: string;
  intentPda?: string;
  slotsRemaining?: number;
};

type Solver = {
  id: string;
  stake: string;
  reputation: number;
  settleRate: number;
  timeoutRate: number;
  activeExposure: string;
};

type Tab = "requests" | "solvers" | "analytics" | "api" | "settings";

const RELAY_BASE =
  (import.meta.env.VITE_FLINT_RELAY_BASE as string | undefined) ?? "http://127.0.0.1:8787";

const PROGRAM_ID = deployArtifact.programId;

const benchmarkByName = benchmarkArtifact.scenarios.reduce<
  Record<string, (typeof benchmarkArtifact.scenarios)[number]>
>((acc, scenario) => {
  acc[scenario.name] = scenario;
  return acc;
}, {});

// ===== MAIN APP =====
export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("requests");
  const [relayHealth, setRelayHealth] = useState<"unknown" | "live" | "down">("unknown");
  const [requests, setRequests] = useState<RelayRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<RelayRequest | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mock solvers data
  const solvers: Solver[] = useMemo(() => [
    {
      id: "CB8Jxc2jrt6woTxm5tsd8fmEc5amsUhgeQpZ7X2HaBiC",
      stake: "10.0",
      reputation: 98,
      settleRate: 99.2,
      timeoutRate: 0.8,
      activeExposure: "2.5",
    },
    {
      id: "9vMJfxuKxXBoEa7rM12mYLMwTacLMLDJqHozw96NQLyf",
      stake: "5.0",
      reputation: 94,
      settleRate: 96.5,
      timeoutRate: 3.5,
      activeExposure: "1.2",
    },
    {
      id: "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
      stake: "7.5",
      reputation: 89,
      settleRate: 94.1,
      timeoutRate: 5.9,
      activeExposure: "0.8",
    },
  ], []);

  // Seeded requests for demo
  const seededRequests = useMemo<RelayRequest[]>(() => [
    {
      requestId: "req-0x7a3f",
      status: "live",
      createdAt: new Date(Date.now() - 5000).toISOString(),
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inputAmount: "50000000000",
      minOutputAmount: "9500000000",
      integrator: "phantom-wallet",
      quotes: [
        { quoteId: "q1", solverId: solvers[0].id, outputAmount: "9650000000", validUntil: new Date(Date.now() + 30000).toISOString() },
        { quoteId: "q2", solverId: solvers[1].id, outputAmount: "9620000000", validUntil: new Date(Date.now() + 30000).toISOString() },
      ],
      slotsRemaining: 45,
    },
    {
      requestId: "req-0x4b2e",
      status: "settling",
      createdAt: new Date(Date.now() - 60000).toISOString(),
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inputAmount: "100000000000",
      minOutputAmount: "19000000000",
      integrator: "jupiter-terminal",
      quotes: [
        { quoteId: "q3", solverId: solvers[0].id, outputAmount: "19450000000", validUntil: new Date(Date.now() + 15000).toISOString() },
      ],
      selectedQuoteId: "q3",
      executionPlan: { selectedSolverId: solvers[0].id, quote: { outputAmount: "19450000000" } },
    },
    {
      requestId: happyArtifact.intent.slice(0, 12),
      status: "settled",
      createdAt: happyArtifact.submitIntentSignature,
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inputAmount: "100000000",
      minOutputAmount: "95000000",
      integrator: "trade-bot",
      quotes: [
        { quoteId: happyArtifact.winningBid, solverId: happyArtifact.solver, outputAmount: "98000000", validUntil: happyArtifact.terminalSignature },
      ],
      selectedQuoteId: happyArtifact.winningBid,
      executionPlan: { selectedSolverId: happyArtifact.solver, quote: { outputAmount: "98000000" } },
      proofExplorer: happyArtifact.terminalExplorer,
      proofKind: "happy",
      settlementTx: happyArtifact.terminalSignature,
      intentPda: happyArtifact.intent,
    },
    {
      requestId: timeoutArtifact.intent.slice(0, 12),
      status: "refunded",
      createdAt: timeoutArtifact.submitIntentSignature,
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inputAmount: "100000000",
      minOutputAmount: "95000000",
      integrator: "dex-aggregator",
      quotes: [
        { quoteId: timeoutArtifact.winningBid, solverId: timeoutArtifact.solver, outputAmount: "98000000", validUntil: timeoutArtifact.terminalSignature },
      ],
      selectedQuoteId: timeoutArtifact.winningBid,
      executionPlan: { selectedSolverId: timeoutArtifact.solver, quote: { outputAmount: "98000000" } },
      proofExplorer: timeoutArtifact.terminalExplorer,
      proofKind: "timeout",
      refundTx: timeoutArtifact.terminalSignature,
      intentPda: timeoutArtifact.intent,
    },
    {
      requestId: "req-0x1c9d",
      status: "slashed",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inputAmount: "25000000000",
      minOutputAmount: "4750000000",
      integrator: "trade-bot",
      quotes: [
        { quoteId: "q5", solverId: solvers[2].id, outputAmount: "4820000000", validUntil: new Date(Date.now() - 3500000).toISOString() },
      ],
      selectedQuoteId: "q5",
      executionPlan: { selectedSolverId: solvers[2].id, quote: { outputAmount: "4820000000" } },
      slashTx: "3xYz...mock",
    },
    {
      requestId: "req-0x8e5a",
      status: "cancelled",
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
      inputAmount: "10000000000",
      minOutputAmount: "9800000000",
      integrator: "api-user",
      quotes: [],
    },
  ], [solvers]);

  // Load seeded data on mount
  useEffect(() => {
    setRequests(seededRequests);
    setSelectedRequest(seededRequests[0]);
  }, [seededRequests]);

  // Poll relay health
  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const response = await fetch(`${RELAY_BASE}/health`);
        if (!cancelled) {
          setRelayHealth(response.ok ? "live" : "down");
        }
      } catch {
        if (!cancelled) setRelayHealth("down");
      }
    }

    checkHealth();
    const timer = setInterval(checkHealth, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function handleSubmitIntent(formData: {
    inputMint: string;
    outputMint: string;
    inputAmount: string;
    minOutputAmount: string;
    integrator: string;
  }) {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${RELAY_BASE}/quote-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(formData),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create request");
      }

      const newRequest: RelayRequest = {
        requestId: payload.requestId,
        status: "live",
        createdAt: new Date().toISOString(),
        ...formData,
        quotes: [],
        slotsRemaining: 100,
      };

      setRequests((prev) => [newRequest, ...prev]);
      setSelectedRequest(newRequest);
      setIsSubmitModalOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="console-shell">
      {/* Top Bar */}
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="wordmark">flint</span>
          <div className="relay-health">
            <span className={`health-dot ${relayHealth}`} />
            <span>relay {relayHealth}</span>
          </div>
        </div>
        <div className="top-bar-right">
          <div className="network-badge">
            <span>devnet</span>
          </div>
          <div className="admin-badge">{PROGRAM_ID.slice(0, 4)}...{PROGRAM_ID.slice(-4)}</div>
          <button className="icon-btn" onClick={() => setActiveTab("settings")}>
            <SettingsIcon />
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === "requests" ? "active" : ""}`}
          onClick={() => setActiveTab("requests")}
        >
          Requests
        </button>
        <button
          className={`tab-btn ${activeTab === "solvers" ? "active" : ""}`}
          onClick={() => setActiveTab("solvers")}
        >
          Solvers
        </button>
        <button
          className={`tab-btn ${activeTab === "analytics" ? "active" : ""}`}
          onClick={() => setActiveTab("analytics")}
        >
          Analytics
        </button>
        <button
          className={`tab-btn ${activeTab === "api" ? "active" : ""}`}
          onClick={() => setActiveTab("api")}
        >
          API
        </button>
        <button
          className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === "requests" && (
          <RequestsTab
            requests={requests}
            selectedRequest={selectedRequest}
            onSelectRequest={setSelectedRequest}
            onOpenSubmitModal={() => setIsSubmitModalOpen(true)}
          />
        )}
        {activeTab === "solvers" && <SolversTab solvers={solvers} />}
        {activeTab === "analytics" && <AnalyticsTab requests={requests} />}
        {activeTab === "api" && <ApiTab />}
        {activeTab === "settings" && <SettingsTab />}
      </main>

      {/* Submit Intent Modal */}
      {isSubmitModalOpen && (
        <SubmitIntentModal
          onClose={() => setIsSubmitModalOpen(false)}
          onSubmit={handleSubmitIntent}
          isSubmitting={isSubmitting}
          error={error}
        />
      )}
    </div>
  );
}

// ===== REQUESTS TAB =====
function RequestsTab({
  requests,
  selectedRequest,
  onSelectRequest,
  onOpenSubmitModal,
}: {
  requests: RelayRequest[];
  selectedRequest: RelayRequest | null;
  onSelectRequest: (r: RelayRequest) => void;
  onOpenSubmitModal: () => void;
}) {
  const singleSolverBps = benchmarkByName["single-solver-baseline"]?.improvementBps ?? 105;
  const twoSolverBps = benchmarkByName["two-solver-competition"]?.improvementBps ?? 315;

  return (
    <div className="requests-layout">
      <div className="requests-main">
        {/* Comparison Strip */}
        <div className="comparison-strip">
          <div className="comparison-strip-item">
            <span className="comparison-strip-label">Baseline</span>
            <span className="comparison-strip-value positive">+{singleSolverBps} bps</span>
          </div>
          <div className="comparison-strip-item">
            <span className="comparison-strip-label">Competition</span>
            <span className="comparison-strip-value positive">+{twoSolverBps} bps</span>
          </div>
          <div className="comparison-strip-item">
            <span className="comparison-strip-label">Timeout Safety</span>
            <span className="comparison-strip-value safe">funds recovered</span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="request-toolbar">
          <div className="toolbar-left">
            <span className="toolbar-title">Request Ledger</span>
            <span className="toolbar-count">{requests.length} requests</span>
          </div>
          <button className="btn-primary" onClick={onOpenSubmitModal}>
            <PlusIcon /> Submit Intent
          </button>
        </div>

        {/* Request Table */}
        <div className="request-table-container">
          <table className="request-table">
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
              {requests.map((req) => (
                <RequestRow
                  key={req.requestId}
                  request={req}
                  isSelected={selectedRequest?.requestId === req.requestId}
                  onClick={() => onSelectRequest(req)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Drawer */}
      {selectedRequest && (
        <DetailDrawer request={selectedRequest} onClose={() => onSelectRequest(requests[0])} />
      )}
    </div>
  );
}

function RequestRow({
  request,
  isSelected,
  onClick,
}: {
  request: RelayRequest;
  isSelected: boolean;
  onClick: () => void;
}) {
  const inputToken = getTokenSymbol(request.inputMint);
  const outputToken = getTokenSymbol(request.outputMint);
  const result = getResultDisplay(request);
  const auctionProgress = request.slotsRemaining ? ((100 - request.slotsRemaining) / 100) * 100 : 100;

  return (
    <tr className={isSelected ? "selected" : ""} onClick={onClick}>
      <td>
        <div className="cell-pair">
          <span className="token-symbol">{inputToken}</span>
          <span style={{ color: "var(--text-tertiary)" }}>/</span>
          <span className="token-symbol">{outputToken}</span>
        </div>
      </td>
      <td className="cell-amount font-mono">{formatAmount(request.inputAmount)}</td>
      <td>
        <span className={`cell-status ${request.status}`}>{request.status}</span>
      </td>
      <td>
        <span className={`cell-result ${result.type}`}>{result.text}</span>
      </td>
      <td>
        <div className="cell-auction">
          {request.status === "live" ? (
            <>
              <div className="auction-progress">
                <div className="auction-progress-bar" style={{ width: `${auctionProgress}%` }} />
              </div>
              <span className="auction-slots">{request.slotsRemaining} slots</span>
            </>
          ) : (
            <span className="auction-slots">{request.quotes?.length ?? 0} bids</span>
          )}
        </div>
      </td>
    </tr>
  );
}

function DetailDrawer({ request, onClose }: { request: RelayRequest; onClose: () => void }) {
  const lifecycleSteps = getLifecycleSteps(request);

  return (
    <aside className="detail-drawer">
      <div className="drawer-header">
        <span className="drawer-title font-mono">{request.requestId}</span>
        <button className="drawer-close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="drawer-content">
        {/* Lifecycle Timeline */}
        <div className="drawer-section">
          <div className="drawer-section-title">Lifecycle</div>
          <div className="lifecycle-timeline">
            {lifecycleSteps.map((step, i) => (
              <div key={i} className={`timeline-step ${step.state}`}>
                <div className="timeline-dot" />
                <div>
                  <div className="timeline-label">{step.label}</div>
                  {step.time && <div className="timeline-time">{step.time}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trade Summary */}
        <div className="drawer-section">
          <div className="drawer-section-title">Trade Summary</div>
          <div className="trade-summary">
            <div className="summary-row">
              <span className="summary-label">Input</span>
              <span className="summary-value">{formatAmount(request.inputAmount)} {getTokenSymbol(request.inputMint)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Min Output</span>
              <span className="summary-value">{formatAmount(request.minOutputAmount)} {getTokenSymbol(request.outputMint)}</span>
            </div>
            {request.executionPlan?.quote?.outputAmount && (
              <div className="summary-row">
                <span className="summary-label">Output</span>
                <span className="summary-value highlight">
                  {formatAmount(request.executionPlan.quote.outputAmount)} {getTokenSymbol(request.outputMint)}
                </span>
              </div>
            )}
            {request.executionPlan?.quote?.outputAmount && request.minOutputAmount && (
              <div className="summary-row">
                <span className="summary-label">Improvement</span>
                <span className="summary-value highlight">
                  +{calculateBps(request.minOutputAmount, request.executionPlan.quote.outputAmount)} bps
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bid History */}
        {request.quotes && request.quotes.length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-title">Bid History</div>
            <div className="bid-list">
              {request.quotes.map((quote) => (
                <div
                  key={quote.quoteId}
                  className={`bid-item ${quote.quoteId === request.selectedQuoteId ? "winner" : ""}`}
                >
                  <span className="bid-solver">{truncateAddress(quote.solverId)}</span>
                  <span className="bid-amount">{formatAmount(quote.outputAmount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* On-chain References */}
        <div className="drawer-section">
          <div className="drawer-section-title">On-chain References</div>
          <div className="onchain-refs">
            {request.intentPda && (
              <div className="onchain-row">
                <span className="onchain-label">Intent PDA</span>
                <a
                  className="onchain-value"
                  href={`https://explorer.solana.com/address/${request.intentPda}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {truncateAddress(request.intentPda)}
                </a>
              </div>
            )}
            {request.settlementTx && (
              <div className="onchain-row">
                <span className="onchain-label">Settlement Tx</span>
                <a
                  className="onchain-value"
                  href={`https://explorer.solana.com/tx/${request.settlementTx}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {truncateAddress(request.settlementTx)}
                </a>
              </div>
            )}
            {request.refundTx && (
              <div className="onchain-row">
                <span className="onchain-label">Refund Tx</span>
                <a
                  className="onchain-value"
                  href={`https://explorer.solana.com/tx/${request.refundTx}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {truncateAddress(request.refundTx)}
                </a>
              </div>
            )}
            {request.slashTx && (
              <div className="onchain-row">
                <span className="onchain-label">Slash Tx</span>
                <a
                  className="onchain-value"
                  href={`https://explorer.solana.com/tx/${request.slashTx}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {truncateAddress(request.slashTx)}
                </a>
              </div>
            )}
            {request.proofExplorer && (
              <div className="onchain-row">
                <span className="onchain-label">Explorer</span>
                <a className="onchain-value" href={request.proofExplorer} target="_blank" rel="noreferrer">
                  View on Solana Explorer
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ===== SOLVERS TAB =====
function SolversTab({ solvers }: { solvers: Solver[] }) {
  return (
    <div className="solvers-layout">
      <table className="solvers-table">
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
          {solvers.map((solver) => (
            <tr key={solver.id}>
              <td>
                <div className="solver-name">
                  <div className="solver-avatar">{solver.id.slice(0, 2)}</div>
                  <span className="solver-id">{truncateAddress(solver.id)}</span>
                </div>
              </td>
              <td className="font-mono">{solver.stake} SOL</td>
              <td>
                <div className="reputation-bar">
                  <div className="reputation-track">
                    <div className="reputation-fill" style={{ width: `${solver.reputation}%` }} />
                  </div>
                  <span className="reputation-value">{solver.reputation}%</span>
                </div>
              </td>
              <td className="font-mono">{solver.settleRate}%</td>
              <td className="font-mono">{solver.timeoutRate}%</td>
              <td className="font-mono">{solver.activeExposure} SOL</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== ANALYTICS TAB =====
function AnalyticsTab({ requests }: { requests: RelayRequest[] }) {
  const settledCount = requests.filter((r) => r.status === "settled").length;
  const refundedCount = requests.filter((r) => r.status === "refunded").length;
  const totalVolume = requests.reduce((sum, r) => sum + BigInt(r.inputAmount ?? "0"), 0n);

  return (
    <div className="analytics-layout">
      <div className="analytics-grid">
        <div className="stat-card">
          <div className="stat-label">24h Volume</div>
          <div className="stat-value highlight">{formatLargeAmount(totalVolume)} SOL</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Improvement</div>
          <div className="stat-value">+{benchmarkByName["two-solver-competition"]?.improvementBps ?? 315} bps</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Settlement Rate</div>
          <div className="stat-value">{requests.length > 0 ? ((settledCount / requests.length) * 100).toFixed(1) : 0}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Timeout Rate</div>
          <div className="stat-value">{requests.length > 0 ? ((refundedCount / requests.length) * 100).toFixed(1) : 0}%</div>
        </div>
      </div>

      <div className="benchmark-section">
        <div className="benchmark-title">Benchmark Results</div>
        <div className="benchmark-cards">
          <div className="benchmark-card">
            <div className="benchmark-card-title">Single Solver Baseline</div>
            <div className="benchmark-metrics">
              <div className="benchmark-row">
                <span className="benchmark-label">Min Output</span>
                <span className="benchmark-value font-mono">95,000,000</span>
              </div>
              <div className="benchmark-row">
                <span className="benchmark-label">Result</span>
                <span className="benchmark-value font-mono">96,000,000</span>
              </div>
              <div className="benchmark-row">
                <span className="benchmark-label">Improvement</span>
                <span className="benchmark-value positive font-mono">+105 bps</span>
              </div>
            </div>
          </div>
          <div className="benchmark-card">
            <div className="benchmark-card-title">Two Solver Competition</div>
            <div className="benchmark-metrics">
              <div className="benchmark-row">
                <span className="benchmark-label">Min Output</span>
                <span className="benchmark-value font-mono">95,000,000</span>
              </div>
              <div className="benchmark-row">
                <span className="benchmark-label">Result</span>
                <span className="benchmark-value font-mono">98,000,000</span>
              </div>
              <div className="benchmark-row">
                <span className="benchmark-label">Improvement</span>
                <span className="benchmark-value positive font-mono">+315 bps</span>
              </div>
            </div>
          </div>
          <div className="benchmark-card">
            <div className="benchmark-card-title">Timeout Recovery</div>
            <div className="benchmark-metrics">
              <div className="benchmark-row">
                <span className="benchmark-label">Scenario</span>
                <span className="benchmark-value">Bid goes stale</span>
              </div>
              <div className="benchmark-row">
                <span className="benchmark-label">Result</span>
                <span className="benchmark-value font-mono">100,000,000 input</span>
              </div>
              <div className="benchmark-row">
                <span className="benchmark-label">Outcome</span>
                <span className="benchmark-value safe">Funds recovered</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== API TAB =====
function ApiTab() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>("/quote-request");

  const endpoints = [
    { method: "GET", path: "/health" },
    { method: "POST", path: "/quote-request" },
    { method: "POST", path: "/solver/quote" },
    { method: "POST", path: "/execute" },
    { method: "GET", path: "/status/:requestId" },
    { method: "GET", path: "/quote-requests" },
  ];

  return (
    <div className="api-layout">
      <div className="api-sidebar">
        <div>
          <div className="api-section-title">Base URL</div>
          <div className="api-base-url">{RELAY_BASE}</div>
        </div>
        <div>
          <div className="api-section-title">Endpoints</div>
          <div className="endpoint-list">
            {endpoints.map((ep) => (
              <button
                key={ep.path}
                className={`endpoint-item ${selectedEndpoint === ep.path ? "active" : ""}`}
                onClick={() => setSelectedEndpoint(ep.path)}
              >
                <span className={`endpoint-method ${ep.method.toLowerCase()}`}>{ep.method}</span>
                <span className="endpoint-path">{ep.path}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="api-content">
        <div className="code-block">
          <div className="code-block-title">Sample Request</div>
          <pre>{getSampleRequest(selectedEndpoint)}</pre>
        </div>
        <div className="code-block">
          <div className="code-block-title">Sample Response</div>
          <pre>{getSampleResponse(selectedEndpoint)}</pre>
        </div>
        <div className="code-block">
          <div className="code-block-title">TypeScript SDK</div>
          <pre>{`import { FlintRelayClient } from '@flint/relay-client';

const client = new FlintRelayClient('${RELAY_BASE}');

// Create a quote request
const result = await client.createQuoteRequest({
  inputMint: 'So111...112',
  outputMint: 'EPjFW...Dt1v',
  inputAmount: '1000000000',
  minOutputAmount: '950000000',
  integrator: 'my-app'
});`}</pre>
        </div>
      </div>
    </div>
  );
}

// ===== SETTINGS TAB =====
function SettingsTab() {
  return (
    <div className="settings-layout">
      <div className="settings-section">
        <div className="settings-section-title">Relay Configuration</div>
        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-label">Relay URL</span>
            <span className="settings-value">{RELAY_BASE}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Environment</span>
            <span className="settings-value">devnet</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Network</span>
            <span className="settings-value">Solana Devnet</span>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">Program</div>
        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-label">Program ID</span>
            <span className="settings-value">{PROGRAM_ID}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Config PDA</span>
            <span className="settings-value">6Rw9B5E7MZAe8xtTw4V4QbGB3rq3TBWpFh9rPJqbQcRK</span>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">Admin</div>
        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-label">Operator Wallet</span>
            <span className="settings-value">AJh1ptSMEVMUjxXKsJ6gnutvodHAozjBW2NQZKxygCV</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== SUBMIT INTENT MODAL =====
function SubmitIntentModal({
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  onClose: () => void;
  onSubmit: (data: {
    inputMint: string;
    outputMint: string;
    inputAmount: string;
    minOutputAmount: string;
    integrator: string;
  }) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [formData, setFormData] = useState({
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inputAmount: "1000000000",
    minOutputAmount: "950000000",
    integrator: "flint-console",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(formData);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Submit Intent</span>
          <button className="modal-close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-field">
                <label className="form-label">Input Mint</label>
                <input
                  className="form-input"
                  value={formData.inputMint}
                  onChange={(e) => setFormData((f) => ({ ...f, inputMint: e.target.value }))}
                />
              </div>
              <div className="form-field">
                <label className="form-label">Output Mint</label>
                <input
                  className="form-input"
                  value={formData.outputMint}
                  onChange={(e) => setFormData((f) => ({ ...f, outputMint: e.target.value }))}
                />
              </div>
              <div className="form-field">
                <label className="form-label">Input Amount</label>
                <input
                  className="form-input"
                  value={formData.inputAmount}
                  onChange={(e) => setFormData((f) => ({ ...f, inputAmount: e.target.value }))}
                />
              </div>
              <div className="form-field">
                <label className="form-label">Min Output Amount</label>
                <input
                  className="form-input"
                  value={formData.minOutputAmount}
                  onChange={(e) => setFormData((f) => ({ ...f, minOutputAmount: e.target.value }))}
                />
              </div>
              <div className="form-field full-width">
                <label className="form-label">Integrator</label>
                <input
                  className="form-input"
                  value={formData.integrator}
                  onChange={(e) => setFormData((f) => ({ ...f, integrator: e.target.value }))}
                />
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Submitting..." : "Submit Intent"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== ICONS =====
function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ===== UTILITIES =====
function getTokenSymbol(mint?: string): string {
  if (!mint) return "???";
  if (mint.startsWith("So1111")) return "SOL";
  if (mint.startsWith("EPjFWdd5")) return "USDC";
  if (mint.startsWith("mSoL")) return "mSOL";
  if (mint.startsWith("USDC")) return "USDC";
  return mint.slice(0, 4);
}

function formatAmount(value?: string): string {
  if (!value) return "-";
  const num = Number(value);
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2);
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2);
  }
  return num.toLocaleString();
}

function formatLargeAmount(value: bigint): string {
  const num = Number(value);
  if (num >= 1_000_000_000_000) {
    return (num / 1_000_000_000_000).toFixed(2) + "T";
  }
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2) + "B";
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + "M";
  }
  return (num / 1_000_000_000).toFixed(2);
}

function truncateAddress(addr?: string): string {
  if (!addr) return "-";
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function getResultDisplay(request: RelayRequest): { text: string; type: "positive" | "neutral" | "negative" } {
  switch (request.status) {
    case "settled":
      if (request.executionPlan?.quote?.outputAmount && request.minOutputAmount) {
        const bps = calculateBps(request.minOutputAmount, request.executionPlan.quote.outputAmount);
        return { text: `+${bps} bps`, type: "positive" };
      }
      return { text: "protected", type: "positive" };
    case "refunded":
      return { text: "funds recovered", type: "neutral" };
    case "slashed":
      return { text: "slashed 0.05 SOL", type: "negative" };
    case "live":
      return { text: `${request.quotes?.length ?? 0} quotes`, type: "neutral" };
    case "settling":
      return { text: "executing", type: "neutral" };
    default:
      return { text: "-", type: "neutral" };
  }
}

function calculateBps(min: string, actual: string): number {
  const minNum = BigInt(min);
  const actualNum = BigInt(actual);
  if (minNum === 0n) return 0;
  return Number(((actualNum - minNum) * 10000n) / minNum);
}

function getLifecycleSteps(request: RelayRequest): { label: string; state: "complete" | "active" | "pending"; time?: string }[] {
  const steps: { label: string; state: "complete" | "active" | "pending"; time?: string }[] = [];

  // Created
  steps.push({
    label: "Created",
    state: "complete",
    time: request.createdAt ? new Date(request.createdAt).toLocaleTimeString() : undefined,
  });

  // Quotes received
  const hasQuotes = (request.quotes?.length ?? 0) > 0;
  steps.push({
    label: "Quotes received",
    state: hasQuotes ? "complete" : request.status === "live" ? "active" : "pending",
    time: hasQuotes ? `${request.quotes!.length} bids` : undefined,
  });

  // Solver selected
  const hasSolver = !!request.executionPlan?.selectedSolverId;
  steps.push({
    label: "Solver selected",
    state: hasSolver ? "complete" : request.status === "settling" ? "active" : "pending",
    time: hasSolver ? truncateAddress(request.executionPlan!.selectedSolverId) : undefined,
  });

  // Execution
  const isExecuting = request.status === "settling";
  const isTerminal = ["settled", "refunded", "slashed"].includes(request.status);
  steps.push({
    label: "Execution",
    state: isTerminal ? "complete" : isExecuting ? "active" : "pending",
  });

  // Terminal state
  if (request.status === "settled") {
    steps.push({ label: "Settled", state: "complete" });
  } else if (request.status === "refunded") {
    steps.push({ label: "Refunded", state: "complete" });
  } else if (request.status === "slashed") {
    steps.push({ label: "Slashed", state: "complete" });
  } else if (request.status === "cancelled") {
    steps.push({ label: "Cancelled", state: "complete" });
  } else {
    steps.push({ label: "Terminal", state: "pending" });
  }

  return steps;
}

function getSampleRequest(endpoint: string): string {
  switch (endpoint) {
    case "/quote-request":
      return `POST /quote-request
Content-Type: application/json

{
  "inputMint": "So11111111111111111111111111111111111111112",
  "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "inputAmount": "1000000000",
  "minOutputAmount": "950000000",
  "integrator": "my-app",
  "callbackUrl": "https://my-app.com/webhook"
}`;
    case "/solver/quote":
      return `POST /solver/quote
Content-Type: application/json

{
  "requestId": "req-0x7a3f",
  "solverId": "CB8Jxc2jrt6woTxm5tsd8fmEc5amsUhgeQpZ7X2HaBiC",
  "outputAmount": "965000000",
  "validUntil": "2026-04-11T12:00:00Z",
  "route": { "venue": "jupiter-ultra" }
}`;
    case "/execute":
      return `POST /execute
Content-Type: application/json

{
  "requestId": "req-0x7a3f",
  "selectedQuoteId": "quote-solver-b"
}`;
    case "/status/:requestId":
      return `GET /status/req-0x7a3f`;
    case "/quote-requests":
      return `GET /quote-requests?status=live`;
    default:
      return `GET /health`;
  }
}

function getSampleResponse(endpoint: string): string {
  switch (endpoint) {
    case "/quote-request":
      return `{
  "requestId": "req-0x7a3f",
  "status": "pending",
  "createdAt": "2026-04-11T10:30:00Z",
  "quoteDeadlineAt": "2026-04-11T10:30:30Z"
}`;
    case "/solver/quote":
      return `{
  "quoteId": "quote-solver-b",
  "accepted": true
}`;
    case "/execute":
      return `{
  "requestId": "req-0x7a3f",
  "status": "selected",
  "executionPlan": {
    "kernel": "flint-v1",
    "programId": "5ZBavnDgcW1wnhKEiGp8KbQSHq4PcdVVosUcEX1m4bFt",
    "selectedSolverId": "CB8Jxc2jrt6woTxm5tsd8fmEc5amsUhgeQpZ7X2HaBiC",
    "quote": { "outputAmount": "965000000" }
  }
}`;
    case "/status/:requestId":
      return `{
  "requestId": "req-0x7a3f",
  "status": "settled",
  "settlementTx": "2kD3Tb46dsjC2PEQcoPm...",
  "executionPlan": {
    "selectedSolverId": "CB8Jxc2j...",
    "quote": { "outputAmount": "965000000" }
  }
}`;
    default:
      return `{
  "status": "ok",
  "version": "0.1.0-alpha"
}`;
  }
}
