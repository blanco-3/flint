import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import deployArtifact from "../../artifacts/devnet-deploy.json";
import happyArtifact from "../../artifacts/devnet-smoke-happy.json";
import timeoutArtifact from "../../artifacts/devnet-smoke-timeout.json";
import benchmarkArtifact from "../../artifacts/benchmark-local.json";
import sampleQuoteResponse from "../../artifacts/sample-selected-quote-response.json";
import sampleWebhook from "../../artifacts/sample-webhook-payload.json";
import "./index.css";

// === Types ===
type RelayQuote = {
  quoteId: string;
  solverId: string;
  outputAmount: string;
  validUntil: string;
};

type RequestStatus = "LIVE" | "SETTLING" | "SETTLED" | "REFUNDED" | "CANCELLED" | "SLASHED" | "STUCK";

type FlintRequest = {
  id: string;
  pair: { from: string; to: string };
  inputAmount: string;
  minOutput: string;
  status: RequestStatus;
  result: { type: "improvement" | "protected" | "recovered" | "slashed" | "pending"; value: string };
  auction: { slotsRemaining?: number; progress?: number };
  createdAt: string;
  quotes: RelayQuote[];
  selectedQuoteId?: string;
  executionPlan?: {
    selectedSolverId?: string;
    quote?: { outputAmount?: string };
  };
  intentPda?: string;
  settlementTx?: string;
  refundTx?: string;
  slashTx?: string;
};

type Solver = {
  id: string;
  name: string;
  stake: string;
  reputation: number;
  settleRate: number;
  timeoutRate: number;
  activeExposure: string;
};

type Tab = "requests" | "solvers" | "analytics" | "api" | "settings";

// === Constants ===
const RELAY_BASE = (import.meta.env.VITE_FLINT_RELAY_BASE as string | undefined) ?? "http://127.0.0.1:8787";
const PROGRAM_ID = deployArtifact.programId;

const benchmarkByName = benchmarkArtifact.scenarios.reduce<
  Record<string, (typeof benchmarkArtifact.scenarios)[number]>
>((acc, scenario) => {
  acc[scenario.name] = scenario;
  return acc;
}, {});

// === App ===
function App() {
  const [activeTab, setActiveTab] = useState<Tab>("requests");
  const [relayHealth, setRelayHealth] = useState<"unknown" | "live" | "down">("unknown");
  const [requests, setRequests] = useState<FlintRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<FlintRequest | null>(null);
  const [showIntentModal, setShowIntentModal] = useState(false);

  // Seed sample data
  const seededRequests = useMemo<FlintRequest[]>(() => [
    {
      id: "req_8f2a9c",
      pair: { from: "SOL", to: "USDC" },
      inputAmount: "100.00",
      minOutput: "9,500.00",
      status: "SETTLED",
      result: { type: "improvement", value: "+315 bps" },
      auction: {},
      createdAt: new Date(Date.now() - 120000).toISOString(),
      quotes: [
        { quoteId: happyArtifact.winningBid, solverId: "solver-alpha", outputAmount: "9800.00", validUntil: happyArtifact.terminalSignature }
      ],
      selectedQuoteId: happyArtifact.winningBid,
      executionPlan: { selectedSolverId: "solver-alpha", quote: { outputAmount: "9800.00" } },
      intentPda: happyArtifact.intent,
      settlementTx: happyArtifact.terminalSignature,
    },
    {
      id: "req_3d7e1b",
      pair: { from: "SOL", to: "USDC" },
      inputAmount: "50.00",
      minOutput: "4,750.00",
      status: "REFUNDED",
      result: { type: "recovered", value: "funds recovered" },
      auction: {},
      createdAt: new Date(Date.now() - 300000).toISOString(),
      quotes: [
        { quoteId: timeoutArtifact.winningBid, solverId: "solver-beta", outputAmount: "4900.00", validUntil: timeoutArtifact.terminalSignature }
      ],
      selectedQuoteId: timeoutArtifact.winningBid,
      executionPlan: { selectedSolverId: "solver-beta", quote: { outputAmount: "4900.00" } },
      intentPda: timeoutArtifact.intent,
      refundTx: timeoutArtifact.terminalSignature,
    },
    {
      id: "req_1a4f8e",
      pair: { from: "BONK", to: "SOL" },
      inputAmount: "10,000,000",
      minOutput: "0.95",
      status: "LIVE",
      result: { type: "pending", value: "auction active" },
      auction: { slotsRemaining: 12, progress: 60 },
      createdAt: new Date(Date.now() - 5000).toISOString(),
      quotes: [
        { quoteId: "q1", solverId: "solver-alpha", outputAmount: "1.02", validUntil: new Date(Date.now() + 30000).toISOString() },
        { quoteId: "q2", solverId: "solver-gamma", outputAmount: "1.01", validUntil: new Date(Date.now() + 30000).toISOString() }
      ],
    },
    {
      id: "req_9c2d5f",
      pair: { from: "USDC", to: "SOL" },
      inputAmount: "1,000.00",
      minOutput: "10.00",
      status: "SETTLING",
      result: { type: "pending", value: "executing" },
      auction: {},
      createdAt: new Date(Date.now() - 45000).toISOString(),
      quotes: [
        { quoteId: "q3", solverId: "solver-beta", outputAmount: "10.52", validUntil: new Date(Date.now() + 15000).toISOString() }
      ],
      selectedQuoteId: "q3",
      executionPlan: { selectedSolverId: "solver-beta", quote: { outputAmount: "10.52" } },
    },
    {
      id: "req_6b3a2c",
      pair: { from: "SOL", to: "BONK" },
      inputAmount: "5.00",
      minOutput: "45,000,000",
      status: "SLASHED",
      result: { type: "slashed", value: "slashed 0.05 SOL" },
      auction: {},
      createdAt: new Date(Date.now() - 600000).toISOString(),
      quotes: [
        { quoteId: "q4", solverId: "solver-delta", outputAmount: "48,000,000", validUntil: new Date(Date.now() - 500000).toISOString() }
      ],
      selectedQuoteId: "q4",
      executionPlan: { selectedSolverId: "solver-delta", quote: { outputAmount: "48,000,000" } },
      slashTx: "5abc...xyz",
    },
    {
      id: "req_4e7d9a",
      pair: { from: "SOL", to: "USDC" },
      inputAmount: "25.00",
      minOutput: "2,375.00",
      status: "SETTLED",
      result: { type: "improvement", value: "+105 bps" },
      auction: {},
      createdAt: new Date(Date.now() - 180000).toISOString(),
      quotes: [
        { quoteId: "q5", solverId: "solver-alpha", outputAmount: "2,400.00", validUntil: new Date(Date.now() - 150000).toISOString() }
      ],
      selectedQuoteId: "q5",
      executionPlan: { selectedSolverId: "solver-alpha", quote: { outputAmount: "2,400.00" } },
      settlementTx: "3def...uvw",
    },
  ], []);

  const seededSolvers: Solver[] = useMemo(() => [
    { id: "solver-alpha", name: "Alpha Solver", stake: "500 SOL", reputation: 98, settleRate: 99.2, timeoutRate: 0.3, activeExposure: "125 SOL" },
    { id: "solver-beta", name: "Beta Solver", stake: "350 SOL", reputation: 95, settleRate: 97.8, timeoutRate: 0.8, activeExposure: "89 SOL" },
    { id: "solver-gamma", name: "Gamma Solver", stake: "280 SOL", reputation: 92, settleRate: 96.5, timeoutRate: 1.2, activeExposure: "45 SOL" },
    { id: "solver-delta", name: "Delta Solver", stake: "150 SOL", reputation: 78, settleRate: 89.0, timeoutRate: 4.5, activeExposure: "0 SOL" },
  ], []);

  useEffect(() => {
    setRequests(seededRequests);
    if (seededRequests.length > 0) {
      setSelectedRequest(seededRequests[0]);
    }

    // Try to ping relay
    fetch(`${RELAY_BASE}/health`)
      .then((res) => {
        if (res.ok) setRelayHealth("live");
        else setRelayHealth("down");
      })
      .catch(() => setRelayHealth("down"));
  }, [seededRequests]);

  return (
    <div className="console">
      <TopBar relayHealth={relayHealth} />
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="main">
        {activeTab === "requests" && (
          <>
            <div className="content">
              <RequestsTab
                requests={requests}
                selectedRequest={selectedRequest}
                onSelectRequest={setSelectedRequest}
                onOpenModal={() => setShowIntentModal(true)}
              />
            </div>
            {selectedRequest && (
              <DetailDrawer
                request={selectedRequest}
                onClose={() => setSelectedRequest(null)}
              />
            )}
          </>
        )}
        
        {activeTab === "solvers" && (
          <div className="content">
            <SolversTab solvers={seededSolvers} />
          </div>
        )}
        
        {activeTab === "analytics" && (
          <div className="content">
            <AnalyticsTab requests={requests} />
          </div>
        )}
        
        {activeTab === "api" && (
          <div className="content">
            <ApiTab />
          </div>
        )}
        
        {activeTab === "settings" && (
          <div className="content">
            <SettingsTab />
          </div>
        )}
      </div>

      {showIntentModal && (
        <SubmitIntentModal
          onClose={() => setShowIntentModal(false)}
          onSubmit={(data) => {
            const newRequest: FlintRequest = {
              id: `req_${Math.random().toString(36).slice(2, 8)}`,
              pair: { from: data.inputMint.slice(0, 4), to: data.outputMint.slice(0, 4) },
              inputAmount: data.inputAmount,
              minOutput: data.minOutputAmount,
              status: "LIVE",
              result: { type: "pending", value: "auction active" },
              auction: { slotsRemaining: 20, progress: 0 },
              createdAt: new Date().toISOString(),
              quotes: [],
            };
            setRequests((prev) => [newRequest, ...prev]);
            setSelectedRequest(newRequest);
            setShowIntentModal(false);
          }}
        />
      )}
    </div>
  );
}

// === TopBar ===
function TopBar({ relayHealth }: { relayHealth: "unknown" | "live" | "down" }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="wordmark">Flint</span>
        <div className="relay-status">
          <span className={`relay-dot ${relayHealth}`} />
          <span>relay {relayHealth}</span>
        </div>
      </div>
      <div className="topbar-right">
        <div className="network-badge">
          <span>devnet</span>
        </div>
        <div className="wallet-indicator">
          {PROGRAM_ID.slice(0, 4)}...{PROGRAM_ID.slice(-4)}
        </div>
        <button className="icon-btn" aria-label="Settings">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// === TabNav ===
function TabNav({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (tab: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "requests", label: "Requests" },
    { id: "solvers", label: "Solvers" },
    { id: "analytics", label: "Analytics" },
    { id: "api", label: "API" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <nav className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

// === RequestsTab ===
function RequestsTab({
  requests,
  selectedRequest,
  onSelectRequest,
  onOpenModal,
}: {
  requests: FlintRequest[];
  selectedRequest: FlintRequest | null;
  onSelectRequest: (req: FlintRequest) => void;
  onOpenModal: () => void;
}) {
  return (
    <div className="requests-layout">
      <div className="requests-toolbar">
        <button className="btn-primary" onClick={onOpenModal}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Intent
        </button>
      </div>

      <div className="table-container">
        <table className="table">
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
              <tr
                key={req.id}
                className={selectedRequest?.id === req.id ? "selected" : ""}
                onClick={() => onSelectRequest(req)}
              >
                <td>
                  <div className="cell-pair">
                    <span className="pair-from">{req.pair.from}</span>
                    <span className="pair-arrow">→</span>
                    <span className="pair-to">{req.pair.to}</span>
                  </div>
                </td>
                <td>
                  <span className="cell-amount">{req.inputAmount}</span>
                </td>
                <td>
                  <span className={`status-chip status-${req.status}`}>{req.status}</span>
                </td>
                <td>
                  <span className={`cell-result ${getResultClass(req.result.type)}`}>
                    {req.result.value}
                  </span>
                </td>
                <td>
                  {req.status === "LIVE" && req.auction.slotsRemaining !== undefined ? (
                    <div className="cell-auction">
                      <span className="slot-countdown">{req.auction.slotsRemaining} slots</span>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${req.auction.progress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <span className="cell-result result-neutral">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getResultClass(type: string): string {
  switch (type) {
    case "improvement": return "result-positive";
    case "recovered": return "result-positive";
    case "slashed": return "result-negative";
    default: return "result-neutral";
  }
}

// === DetailDrawer ===
function DetailDrawer({ request, onClose }: { request: FlintRequest; onClose: () => void }) {
  const timelineSteps = [
    { label: "Created", complete: true, timestamp: request.createdAt },
    { label: "Quotes Received", complete: request.quotes.length > 0, timestamp: request.quotes.length > 0 ? `${request.quotes.length} quotes` : undefined },
    { label: "Solver Selected", complete: !!request.selectedQuoteId, timestamp: request.executionPlan?.selectedSolverId },
    { label: "Execution", complete: request.status !== "LIVE", active: request.status === "SETTLING" },
    { label: request.status === "REFUNDED" ? "Refunded" : request.status === "SLASHED" ? "Slashed" : "Settled", complete: ["SETTLED", "REFUNDED", "SLASHED"].includes(request.status) },
  ];

  const improvement = request.executionPlan?.quote?.outputAmount && request.minOutput
    ? `+${((parseFloat(request.executionPlan.quote.outputAmount.replace(/,/g, "")) / parseFloat(request.minOutput.replace(/,/g, "")) - 1) * 10000).toFixed(0)} bps`
    : "-";

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <span className="drawer-title">{request.id}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="drawer-content">
        <div className="drawer-section">
          <div className="section-label">Lifecycle</div>
          <div className="timeline">
            {timelineSteps.map((step, i) => (
              <div key={step.label} className="timeline-item">
                <div className="timeline-marker">
                  <div className={`timeline-dot ${step.complete ? "complete" : ""} ${step.active ? "active" : ""}`} />
                  {i < timelineSteps.length - 1 && <div className="timeline-line" />}
                </div>
                <div className="timeline-content">
                  <div className="timeline-label">{step.label}</div>
                  {step.timestamp && <div className="timeline-meta">{step.timestamp}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <div className="section-label">Trade Summary</div>
          <div className="summary-grid">
            <div className="summary-row">
              <span className="summary-label">Input</span>
              <span className="summary-value">{request.inputAmount} {request.pair.from}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Min Output</span>
              <span className="summary-value">{request.minOutput} {request.pair.to}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Quoted Output</span>
              <span className="summary-value">{request.executionPlan?.quote?.outputAmount ?? "-"} {request.pair.to}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Improvement</span>
              <span className="summary-value positive">{improvement}</span>
            </div>
          </div>
        </div>

        <div className="drawer-section">
          <div className="section-label">Bid History</div>
          <div className="bid-list">
            {request.quotes.map((quote) => (
              <div key={quote.quoteId} className={`bid-item ${quote.quoteId === request.selectedQuoteId ? "winner" : ""}`}>
                <span className="bid-solver">{quote.solverId}</span>
                <span className="bid-amount">{quote.outputAmount}</span>
              </div>
            ))}
            {request.quotes.length === 0 && (
              <div className="bid-item">
                <span className="bid-solver">No quotes yet</span>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-section">
          <div className="section-label">On-chain References</div>
          <div className="ref-list">
            {request.intentPda && (
              <div className="ref-item">
                <span className="ref-label">Intent PDA</span>
                <span className="ref-value">
                  <a href={`https://explorer.solana.com/address/${request.intentPda}?cluster=devnet`} target="_blank" rel="noreferrer">
                    {request.intentPda.slice(0, 8)}...{request.intentPda.slice(-6)}
                  </a>
                </span>
              </div>
            )}
            {request.settlementTx && (
              <div className="ref-item">
                <span className="ref-label">Settlement TX</span>
                <span className="ref-value">
                  <a href={`https://explorer.solana.com/tx/${request.settlementTx}?cluster=devnet`} target="_blank" rel="noreferrer">
                    {request.settlementTx.slice(0, 8)}...{request.settlementTx.slice(-6)}
                  </a>
                </span>
              </div>
            )}
            {request.refundTx && (
              <div className="ref-item">
                <span className="ref-label">Refund TX</span>
                <span className="ref-value">
                  <a href={`https://explorer.solana.com/tx/${request.refundTx}?cluster=devnet`} target="_blank" rel="noreferrer">
                    {request.refundTx.slice(0, 8)}...{request.refundTx.slice(-6)}
                  </a>
                </span>
              </div>
            )}
            {request.slashTx && (
              <div className="ref-item">
                <span className="ref-label">Slash TX</span>
                <span className="ref-value">
                  <a href={`https://explorer.solana.com/tx/${request.slashTx}?cluster=devnet`} target="_blank" rel="noreferrer">
                    {request.slashTx.slice(0, 8)}...{request.slashTx.slice(-6)}
                  </a>
                </span>
              </div>
            )}
            {!request.intentPda && !request.settlementTx && !request.refundTx && !request.slashTx && (
              <div className="ref-item">
                <span className="ref-label">Status</span>
                <span className="ref-value">Awaiting on-chain execution</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

// === SolversTab ===
function SolversTab({ solvers }: { solvers: Solver[] }) {
  return (
    <div className="solvers-layout">
      <div className="table-container">
        <table className="table">
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
                  <span className="cell-amount">{solver.name}</span>
                </td>
                <td>
                  <span className="cell-amount">{solver.stake}</span>
                </td>
                <td>
                  <span className={`cell-result ${solver.reputation >= 90 ? "result-positive" : solver.reputation >= 80 ? "result-neutral" : "result-negative"}`}>
                    {solver.reputation}%
                  </span>
                </td>
                <td>
                  <span className="cell-result result-positive">{solver.settleRate}%</span>
                </td>
                <td>
                  <span className={`cell-result ${solver.timeoutRate <= 1 ? "result-positive" : solver.timeoutRate <= 3 ? "result-neutral" : "result-negative"}`}>
                    {solver.timeoutRate}%
                  </span>
                </td>
                <td>
                  <span className="cell-amount">{solver.activeExposure}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// === AnalyticsTab ===
function AnalyticsTab({ requests }: { requests: FlintRequest[] }) {
  const settled = requests.filter((r) => r.status === "SETTLED").length;
  const total = requests.length;
  const settleRate = total > 0 ? ((settled / total) * 100).toFixed(1) : "0";
  const timeouts = requests.filter((r) => r.status === "REFUNDED").length;
  const timeoutRate = total > 0 ? ((timeouts / total) * 100).toFixed(1) : "0";

  return (
    <div className="analytics-layout">
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">24h Volume</div>
          <div className="metric-value">$127,450</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg Improvement</div>
          <div className="metric-value accent">+210 bps</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Settlement Rate</div>
          <div className="metric-value">{settleRate}%</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Timeout Rate</div>
          <div className="metric-value">{timeoutRate}%</div>
        </div>
      </div>

      <div className="benchmark-section">
        <div className="benchmark-title">Benchmark Results</div>
        <div className="benchmark-cards">
          <div className="benchmark-card">
            <div className="benchmark-card-label">Single Solver Baseline</div>
            <div className="benchmark-card-value">+{benchmarkByName["single-solver-baseline"].improvementBps} bps</div>
            <div className="benchmark-card-desc">Minimum competitive improvement</div>
          </div>
          <div className="benchmark-card">
            <div className="benchmark-card-label">Two Solver Competition</div>
            <div className="benchmark-card-value">+{benchmarkByName["two-solver-competition"].improvementBps} bps</div>
            <div className="benchmark-card-desc">Multi-solver auction result</div>
          </div>
          <div className="benchmark-card">
            <div className="benchmark-card-label">Timeout Recovery</div>
            <div className="benchmark-card-value">100%</div>
            <div className="benchmark-card-desc">Funds recovered on timeout</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// === ApiTab ===
function ApiTab() {
  return (
    <div className="api-layout">
      <div className="api-section">
        <div className="api-section-title">Relay Base URL</div>
        <div className="api-url">{RELAY_BASE}</div>
      </div>

      <div className="api-section">
        <div className="api-section-title">Endpoints</div>
        <div className="endpoint-list">
          <div className="endpoint-item">
            <span className="endpoint-method">GET</span>
            <span className="endpoint-path">/health</span>
            <span className="endpoint-desc">Health check</span>
          </div>
          <div className="endpoint-item">
            <span className="endpoint-method post">POST</span>
            <span className="endpoint-path">/quote-request</span>
            <span className="endpoint-desc">Create quote request</span>
          </div>
          <div className="endpoint-item">
            <span className="endpoint-method post">POST</span>
            <span className="endpoint-path">/solver/quote</span>
            <span className="endpoint-desc">Submit solver quote</span>
          </div>
          <div className="endpoint-item">
            <span className="endpoint-method post">POST</span>
            <span className="endpoint-path">/execute</span>
            <span className="endpoint-desc">Execute selected quote</span>
          </div>
          <div className="endpoint-item">
            <span className="endpoint-method">GET</span>
            <span className="endpoint-path">/status/:requestId</span>
            <span className="endpoint-desc">Get request status</span>
          </div>
          <div className="endpoint-item">
            <span className="endpoint-method">GET</span>
            <span className="endpoint-path">/quote-requests</span>
            <span className="endpoint-desc">List all requests</span>
          </div>
        </div>
      </div>

      <div className="api-section">
        <div className="api-section-title">Sample Request</div>
        <pre className="code-block">{`{
  "inputMint": "So11111111111111111111111111111111111111112",
  "outputMint": "USDC111111111111111111111111111111111111111",
  "inputAmount": "1000000",
  "minOutputAmount": "990000",
  "integrator": "my-app",
  "callbackUrl": "https://my-app.com/webhook"
}`}</pre>
      </div>

      <div className="api-section">
        <div className="api-section-title">Sample Selected Quote Response</div>
        <pre className="code-block">{JSON.stringify(sampleQuoteResponse, null, 2)}</pre>
      </div>

      <div className="api-section">
        <div className="api-section-title">Webhook Payload Example</div>
        <pre className="code-block">{JSON.stringify(sampleWebhook, null, 2)}</pre>
      </div>

      <div className="api-section">
        <div className="api-section-title">TypeScript SDK</div>
        <pre className="code-block">{`import { FlintRelayClient } from '@flint/relay-client';

const client = new FlintRelayClient({
  baseUrl: '${RELAY_BASE}',
  integrator: 'my-app',
});

const { requestId } = await client.createQuoteRequest({
  inputMint: 'So111...',
  outputMint: 'USDC1...',
  inputAmount: '1000000',
  minOutputAmount: '990000',
});

const status = await client.getStatus(requestId);`}</pre>
      </div>
    </div>
  );
}

// === SettingsTab ===
function SettingsTab() {
  return (
    <div className="settings-layout">
      <div className="settings-section">
        <div className="settings-title">Relay</div>
        <div className="settings-row">
          <span className="settings-label">Relay URL</span>
          <span className="settings-value">{RELAY_BASE}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Environment</span>
          <span className="settings-value">development</span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-title">Network</div>
        <div className="settings-row">
          <span className="settings-label">Cluster</span>
          <span className="settings-value">devnet</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Program ID</span>
          <span className="settings-value">{PROGRAM_ID.slice(0, 8)}...{PROGRAM_ID.slice(-8)}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">RPC Endpoint</span>
          <span className="settings-value">https://api.devnet.solana.com</span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-title">Operator</div>
        <div className="settings-row">
          <span className="settings-label">Admin Wallet</span>
          <span className="settings-value">{PROGRAM_ID.slice(0, 6)}...{PROGRAM_ID.slice(-6)}</span>
        </div>
        <div className="settings-row">
          <span className="settings-label">Role</span>
          <span className="settings-value">operator</span>
        </div>
      </div>
    </div>
  );
}

// === SubmitIntentModal ===
function SubmitIntentModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: {
    inputMint: string;
    outputMint: string;
    inputAmount: string;
    minOutputAmount: string;
    integrator: string;
    callbackUrl: string;
  }) => void;
}) {
  const [formState, setFormState] = useState({
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "USDC111111111111111111111111111111111111111",
    inputAmount: "1000000",
    minOutputAmount: "990000",
    integrator: "flint-console",
    callbackUrl: "",
  });
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formState.inputMint || !formState.outputMint || !formState.inputAmount || !formState.minOutputAmount) {
      setError("Please fill in all required fields");
      return;
    }
    onSubmit(formState);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Submit Intent</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Input Mint</label>
                <input
                  className="form-input"
                  value={formState.inputMint}
                  onChange={(e) => setFormState((s) => ({ ...s, inputMint: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Output Mint</label>
                <input
                  className="form-input"
                  value={formState.outputMint}
                  onChange={(e) => setFormState((s) => ({ ...s, outputMint: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Input Amount</label>
                <input
                  className="form-input"
                  value={formState.inputAmount}
                  onChange={(e) => setFormState((s) => ({ ...s, inputAmount: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Min Output Amount</label>
                <input
                  className="form-input"
                  value={formState.minOutputAmount}
                  onChange={(e) => setFormState((s) => ({ ...s, minOutputAmount: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Integrator</label>
                <input
                  className="form-input"
                  value={formState.integrator}
                  onChange={(e) => setFormState((s) => ({ ...s, integrator: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Callback URL</label>
                <input
                  className="form-input"
                  value={formState.callbackUrl}
                  onChange={(e) => setFormState((s) => ({ ...s, callbackUrl: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            {error && <p className="form-error">{error}</p>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
