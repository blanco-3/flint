import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  buildCancelTransactions,
  buildSwapTransaction,
  fetchQuote,
  fetchTriggerOrders,
} from "./lib/guard-jupiter";
import devnetDeploy from "../../artifacts/devnet-deploy.json";
import devnetHappy from "../../artifacts/devnet-smoke-happy.json";
import devnetTimeout from "../../artifacts/devnet-smoke-timeout.json";
import {
  buildDemoComparison,
  DEMO_SCENARIOS,
  demoScenarioById,
  getDemoOrders,
  recommendedDemoPresetForScenario,
} from "./lib/guard-demo";
import {
  DEFAULT_SIGNAL_INPUTS,
  POLICY_PRESETS,
  canonicalMint,
  canonicalPairKey,
  canonicalVenue,
  policyCopy,
} from "./lib/guard-policies";
import { fetchPoolSnapshots } from "./lib/guard-market-data";
import {
  evaluateQuoteRisk,
  evaluateTriggerOrders,
  formatPolicySummary,
  statusTone,
} from "./lib/guard-risk";
import {
  connectInjectedWallet,
  disconnectInjectedWallet,
  ensureMainnetConnection,
  executeSerializedTransactions,
  getInjectedWallet,
  shortenAddress,
} from "./lib/guard-wallet";
import {
  type ActivityLogEntry,
  type DemoScenarioId,
  type GuardDataMode,
  type GuardPolicyPreset,
  type OrderAssessment,
  type QuoteComparison,
  type QuoteFormState,
  type RiskSignalInputs,
  type RouteRiskReason,
  type TriggerOrder,
} from "./lib/guard-types";
import type { Dispatch, SetStateAction } from "react";
import { TOKEN_OPTIONS, tokenByMint, tokenChoices } from "./lib/token-options";
import "./index.css";

const STORAGE_KEYS = {
  dataMode: "flint-guard:data-mode",
  demoScenario: "flint-guard:demo-scenario",
  preset: "flint-guard:preset",
  safeMode: "flint-guard:safe-mode",
  panicMode: "flint-guard:panic-mode",
  signals: "flint-guard:signals",
  activity: "flint-guard:activity",
};

const DEFAULT_FORM: QuoteFormState = {
  inputMint: TOKEN_OPTIONS[0].mint,
  outputMint: TOKEN_OPTIONS[1].mint,
  amount: "1",
  slippageBps: 75,
};

export default function App() {
  const [activePanel, setActivePanel] = useState<"trade" | "protect" | "activity" | "settings">(
    "trade"
  );
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [dataMode, setDataMode] = usePersistentState<GuardDataMode>(
    STORAGE_KEYS.dataMode,
    "demo"
  );
  const [demoScenario, setDemoScenario] = usePersistentState<DemoScenarioId>(
    STORAGE_KEYS.demoScenario,
    "fresh-pool-rug"
  );
  const [policyPreset, setPolicyPreset] = usePersistentState<GuardPolicyPreset>(
    STORAGE_KEYS.preset,
    "retail"
  );
  const [safeMode, setSafeMode] = usePersistentState<boolean>(STORAGE_KEYS.safeMode, true);
  const [panicMode, setPanicMode] = usePersistentState<boolean>(STORAGE_KEYS.panicMode, false);
  const [signals, setSignals] = usePersistentState<RiskSignalInputs>(
    STORAGE_KEYS.signals,
    DEFAULT_SIGNAL_INPUTS
  );
  const [activityLog, setActivityLog] = usePersistentState<ActivityLogEntry[]>(
    STORAGE_KEYS.activity,
    []
  );
  const [form, setForm] = useState<QuoteFormState>(DEFAULT_FORM);
  const [comparison, setComparison] = useState<QuoteComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isExecutingSwap, setIsExecutingSwap] = useState(false);
  const [orders, setOrders] = useState<TriggerOrder[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [orderAssessments, setOrderAssessments] = useState<OrderAssessment[]>([]);
  const [selectedOrderKeys, setSelectedOrderKeys] = useState<string[]>([]);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isCancellingOrders, setIsCancellingOrders] = useState(false);
  const [signalDrafts, setSignalDrafts] = useState({
    token: "",
    venue: "",
  });

  const policy = useMemo(() => {
    const preset = policyCopy(POLICY_PRESETS[policyPreset]);
    preset.flaggedTokens = dedupeStrings(preset.flaggedTokens.concat(signals.tokens));
    preset.panicTokens = dedupeStrings(signals.tokens);
    preset.panicPairs = dedupeStrings(signals.pairs);
    preset.panicVenues = dedupeStrings(signals.venues);
    return preset;
  }, [policyPreset, signals]);

  const currentPairKey = useMemo(
    () => canonicalPairKey(form.inputMint, form.outputMint),
    [form.inputMint, form.outputMint]
  );

  const incidentLog = useMemo(
    () =>
      activityLog.filter((entry) => entry.kind === "incident" || entry.severity !== "info"),
    [activityLog]
  );

  useEffect(() => {
    const injected = getInjectedWallet();
    if (injected?.publicKey) {
      setWalletAddress(injected.publicKey.toBase58());
    }
  }, []);

  const activeScenario = useMemo(() => demoScenarioById(demoScenario), [demoScenario]);

  useEffect(() => {
    if (!orders.length) {
      setOrderAssessments([]);
      setSelectedOrderKeys([]);
      return;
    }

    const nextAssessments = evaluateTriggerOrders(orders, policy, panicMode);
    setOrderAssessments(nextAssessments);
    setSelectedOrderKeys(
      nextAssessments.filter((assessment) => assessment.candidate).map((item) => item.order.orderKey)
    );
  }, [orders, policy, panicMode, currentPairKey]);

  async function handleConnectWallet() {
    setWalletError(null);
    try {
      const wallet = await connectInjectedWallet();
      const publicKey = wallet.publicKey?.toBase58();
      if (!publicKey) {
        throw new Error("Wallet connected without a public key.");
      }
      setWalletAddress(publicKey);
      appendLog(setActivityLog, {
        title: "Wallet connected",
        detail: publicKey,
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "wallet_connect_failed";
      setWalletError(message);
      appendLog(setActivityLog, {
        title: "Wallet connection failed",
        detail: message,
        severity: "warning",
        kind: "activity",
      });
    }
  }

  async function handleDisconnectWallet() {
    await disconnectInjectedWallet();
    setWalletAddress(null);
    clearTransientState();
    appendLog(setActivityLog, {
      title: "Wallet disconnected",
      detail: "Cleared live order state.",
      severity: "info",
      kind: "activity",
    });
  }

  async function handleEvaluateRoutes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setComparison(null);
    setComparisonError(null);
    setIsEvaluating(true);

    try {
      if (dataMode === "demo") {
        const comparisonState = buildDemoComparison(demoScenario, policy, safeMode);
        setComparison(comparisonState);
        appendLog(setActivityLog, {
          title: "Demo route scenario evaluated",
          detail: `${activeScenario.label}: ${describeComparison(comparisonState)}`,
          severity:
            comparisonState.baseAssessment.status === "blocked" ? "warning" : "info",
          kind:
            comparisonState.baseAssessment.status === "blocked" ? "incident" : "activity",
        });
        return;
      }

      const amount = rawAmountFromForm(form.amount, form.inputMint);
      const baseQuote = await fetchQuote({
        inputMint: form.inputMint,
        outputMint: form.outputMint,
        amount,
        slippageBps: form.slippageBps,
      });

      const basePools = await fetchPoolSnapshots(
        baseQuote.routePlan.map((hop) => hop.swapInfo.ammKey)
      );
      const baseAssessment = evaluateQuoteRisk(baseQuote, basePools, policy);
      const comparisonState: QuoteComparison = {
        baseQuote: baseQuote,
        baseAssessment: baseAssessment,
        safeQuote: null,
        safeAssessment: null,
        blockedVenuesUsed: [],
        safeMode: safeMode,
        executionTarget: safeMode && baseAssessment.status === "blocked" ? "none" : "base",
      };

      const safeAlternativeNeeded =
        baseAssessment.status === "blocked" || (safeMode && policy.maxHops === 1);
      const blockedVenues = dedupeStrings(
        baseAssessment.blockedVenues
          .concat(baseQuote.routePlan.map((hop) => hop.swapInfo.label))
          .concat(policy.denylistVenues)
          .concat(policy.panicVenues)
      );

      if (safeAlternativeNeeded) {
        const attempts = dedupeQuoteAttempts([
          {
            excludeDexes: blockedVenues.length ? blockedVenues : undefined,
            onlyDirectRoutes: policy.maxHops === 1,
          },
          {
            excludeDexes: blockedVenues.length ? blockedVenues : undefined,
            onlyDirectRoutes: true,
          },
        ]);

        for (const attempt of attempts) {
          try {
            const safeQuote = await fetchQuote({
              inputMint: form.inputMint,
              outputMint: form.outputMint,
              amount,
              slippageBps: form.slippageBps,
              excludeDexes: attempt.excludeDexes,
              onlyDirectRoutes: attempt.onlyDirectRoutes,
            });
            const safePools = await fetchPoolSnapshots(
              safeQuote.routePlan.map((hop) => hop.swapInfo.ammKey)
            );
            const safeAssessment = evaluateQuoteRisk(safeQuote, safePools, policy);
            comparisonState.safeQuote = safeQuote;
            comparisonState.safeAssessment = safeAssessment;
            comparisonState.blockedVenuesUsed = blockedVenues;
            if (safeAssessment.status !== "blocked") {
              comparisonState.executionTarget = safeMode ? "safe" : "base";
              break;
            }
          } catch {
            continue;
          }
        }
      } else if (baseAssessment.status !== "blocked") {
        comparisonState.executionTarget = "base";
      }

      if (safeMode && comparisonState.baseAssessment.status === "blocked") {
        if (comparisonState.safeAssessment && comparisonState.safeAssessment.status !== "blocked") {
          comparisonState.executionTarget = "safe";
        } else {
          comparisonState.executionTarget = "none";
        }
      }

      setComparison(comparisonState);
      appendLog(setActivityLog, {
        title: "Route comparison updated",
        detail: describeComparison(comparisonState),
        severity:
          comparisonState.baseAssessment.status === "blocked" ? "warning" : "info",
        kind:
          comparisonState.baseAssessment.status === "blocked" ? "incident" : "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "route_fetch_failed";
      setComparisonError(message);
      appendLog(setActivityLog, {
        title: "Route evaluation failed",
        detail: message,
        severity: "critical",
        kind: "incident",
      });
    } finally {
      setIsEvaluating(false);
    }
  }

  async function handleExecuteSwap(target: "base" | "safe") {
    if (!comparison) {
      return;
    }

    const quote = target === "safe" ? comparison.safeQuote : comparison.baseQuote;
    if (!quote) {
      return;
    }

    setIsExecutingSwap(true);
    try {
      if (dataMode === "demo") {
        appendLog(setActivityLog, {
          title: "Demo swap simulated",
          detail:
            target === "safe"
              ? "Safer route execution simulated for judge demo."
              : "Base route execution simulated for comparison.",
          severity: target === "safe" ? "info" : "warning",
          kind: target === "safe" ? "activity" : "incident",
        });
        return;
      }

      if (!walletAddress) {
        throw new Error("Connect a wallet before executing a live swap.");
      }

      const swap = await buildSwapTransaction(walletAddress, quote);
      const connection = ensureMainnetConnection();
      const signatures = await executeSerializedTransactions(
        [swap.swapTransaction],
        connection
      );
      appendLog(setActivityLog, {
        title: "Swap submitted",
        detail: signatures.join(", "),
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "swap_execution_failed";
      appendLog(setActivityLog, {
        title: "Swap execution failed",
        detail: message,
        severity: "critical",
        kind: "incident",
      });
    } finally {
      setIsExecutingSwap(false);
    }
  }

  async function handleLoadOrders() {
    if (dataMode === "demo") {
      const demoOrders = getDemoOrders(demoScenario);
      setOrders(demoOrders);
      setOrdersLoaded(true);
      setOrderError(null);
      appendLog(setActivityLog, {
        title: "Demo trigger orders loaded",
        detail: `${demoOrders.length} seeded panic-order candidate(s)`,
        severity: "info",
        kind: "activity",
      });
      return;
    }

    if (!walletAddress) {
      setOrderError("Connect a wallet to inspect open trigger orders.");
      return;
    }

    setIsLoadingOrders(true);
    setOrderError(null);
    try {
      const response = await fetchTriggerOrders(walletAddress);
      setOrders(response.orders);
      setOrdersLoaded(true);
      appendLog(setActivityLog, {
        title: "Open trigger orders loaded",
        detail: `${response.orders.length} active order(s)`,
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "order_fetch_failed";
      setOrderError(message);
      appendLog(setActivityLog, {
        title: "Open trigger order fetch failed",
        detail: message,
        severity: "warning",
        kind: "incident",
      });
    } finally {
      setIsLoadingOrders(false);
    }
  }

  async function handleCancelOrders() {
    if (!selectedOrderKeys.length) {
      return;
    }

    setIsCancellingOrders(true);
    try {
      if (dataMode === "demo") {
        setOrders((current) =>
          current.filter((order) => !selectedOrderKeys.includes(order.orderKey))
        );
        appendLog(setActivityLog, {
          title: "Demo panic cancel simulated",
          detail: `${selectedOrderKeys.length} risky order(s) removed from the seeded board.`,
          severity: "warning",
          kind: "incident",
        });
        return;
      }

      if (!walletAddress) {
        throw new Error("Connect a wallet before submitting live panic cancels.");
      }

      const response = await buildCancelTransactions(walletAddress, selectedOrderKeys);
      const connection = ensureMainnetConnection();
      const signatures = await executeSerializedTransactions(response.transactions, connection);
      appendLog(setActivityLog, {
        title: "Panic cancel submitted",
        detail: signatures.join(", "),
        severity: "warning",
        kind: "incident",
      });
      await handleLoadOrders();
    } catch (error) {
      const message = error instanceof Error ? error.message : "panic_cancel_failed";
      appendLog(setActivityLog, {
        title: "Panic cancel failed",
        detail: message,
        severity: "critical",
        kind: "incident",
      });
    } finally {
      setIsCancellingOrders(false);
    }
  }

  function toggleOrderSelection(orderKey: string) {
    setSelectedOrderKeys((current) =>
      current.includes(orderKey)
        ? current.filter((item) => item !== orderKey)
        : current.concat(orderKey)
    );
  }

  function addSignal(kind: keyof typeof signalDrafts) {
    const raw = signalDrafts[kind].trim();
    if (!raw) return;
    if (kind === "token") {
      setSignals((current) => ({
        ...current,
        tokens: dedupeStrings(current.tokens.concat(canonicalMint(raw))),
      }));
    } else {
      setSignals((current) => ({
        ...current,
        venues: dedupeStrings(current.venues.concat(canonicalVenue(raw))),
      }));
    }
    setSignalDrafts((current) => ({ ...current, [kind]: "" }));
  }

  function addCurrentPairSignal() {
    setSignals((current) => ({
      ...current,
      pairs: dedupeStrings(current.pairs.concat(currentPairKey)),
    }));
  }

  function removeSignal(kind: keyof RiskSignalInputs, value: string) {
    setSignals((current) => ({
      ...current,
      [kind]: current[kind].filter((item) => item !== value),
    }));
  }

  function flipPair() {
    setForm((current) => ({
      ...current,
      inputMint: current.outputMint,
      outputMint: current.inputMint,
    }));
  }

  function clearTransientState() {
    setComparison(null);
    setComparisonError(null);
    setOrders([]);
    setOrdersLoaded(false);
    setSelectedOrderKeys([]);
    setOrderError(null);
  }

  function handleDataModeChange(nextMode: GuardDataMode) {
    setDataMode(nextMode);
    clearTransientState();
    if (nextMode === "demo") {
      const scenario = demoScenarioById(demoScenario);
      setForm(scenario.form);
      setSignals(scenario.signals);
      setPolicyPreset(recommendedDemoPresetForScenario(demoScenario));
    }
  }

  function activateDemoScenario(nextScenario: DemoScenarioId) {
    const scenario = demoScenarioById(nextScenario);
    setDemoScenario(nextScenario);
    setForm(scenario.form);
    setSignals(scenario.signals);
    setPolicyPreset(recommendedDemoPresetForScenario(nextScenario));
    clearTransientState();
    appendLog(setActivityLog, {
      title: "Demo scenario armed",
      detail: scenario.label,
      severity: "info",
      kind: "activity",
    });
  }

  const canExecuteBase =
    (dataMode === "demo" || !!walletAddress) &&
    !!comparison &&
    (!safeMode || comparison.executionTarget === "base") &&
    !isExecutingSwap;
  const canExecuteSafe =
    (dataMode === "demo" || !!walletAddress) &&
    !!comparison?.safeQuote &&
    comparison.executionTarget === "safe" &&
    !isExecutingSwap;

  function handleResetSession() {
    setForm(dataMode === "demo" ? activeScenario.form : DEFAULT_FORM);
    setSignals(dataMode === "demo" ? activeScenario.signals : DEFAULT_SIGNAL_INPUTS);
    clearTransientState();
    setActivityLog([]);
    setSafeMode(true);
    setPanicMode(false);
  }

  function handleExportBundle() {
    const payload = {
      exportedAt: new Date().toISOString(),
      dataMode,
      demoScenario: dataMode === "demo" ? demoScenario : null,
      policyPreset,
      policy,
      signals,
      form,
      comparison,
      orders,
      ordersLoaded,
      activityLog,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flint-guard-incident-${Date.now()}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    appendLog(setActivityLog, {
      title: "Incident bundle exported",
      detail: "Downloaded the current demo/log/risk snapshot as JSON.",
      severity: "info",
      kind: "activity",
    });
  }

  return (
    <div className="guard-shell">
      <header className="guard-nav">
        <div className="nav-brand">
          <FlintMark />
          <div>
            <div className="eyebrow">Flint Guard</div>
            <div className="brand-line">Safety-first execution on the Flint stack</div>
          </div>
        </div>

        <div className="nav-actions">
          <span className="nav-pill">Solana</span>
          <span className="nav-pill">{dataMode === "demo" ? "Seeded demo" : "Live APIs"}</span>
          <div className="status-stack">
            <span className={`pill ${safeMode ? "pill-safe" : "pill-live"}`}>
              {safeMode ? "safe mode on" : "safe mode off"}
            </span>
            <span className={`pill ${panicMode ? "pill-alert" : "pill-muted"}`}>
              {panicMode ? "panic mode armed" : "panic mode idle"}
            </span>
          </div>
          <button className="ghost-button" onClick={handleResetSession}>
            Reset
          </button>
          <button className="ghost-button" onClick={handleExportBundle}>
            Export
          </button>
          {walletAddress ? (
            <div className="wallet-card">
              <span className="wallet-label">{shortenAddress(walletAddress)}</span>
              <button className="ghost-button" onClick={handleDisconnectWallet}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="primary-button" onClick={handleConnectWallet}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      <section className="hero-stage">
        <div className="stage-copy">
          <h1>Trade safer.<br />Exit faster.</h1>
          <p>Route compare, risk explain, and panic-order triage — powered by the Flint proof stack.</p>
        </div>

        {dataMode === "demo" ? (
          <Banner tone="warning">
            Seeded demo active — route execution and panic cancellation are simulated for judges.
          </Banner>
        ) : null}

        {walletError ? <Banner tone="warning">{walletError}</Banner> : null}
        {comparisonError ? <Banner tone="critical">{comparisonError}</Banner> : null}
        {orderError ? <Banner tone="warning">{orderError}</Banner> : null}

        <section className={`trade-shell${activePanel !== "trade" ? " wide-panel" : ""}`}>
          <div className="shell-header">
            <div className="shell-tabs">
              <ShellTab
                active={activePanel === "trade"}
                label="Trade"
                onClick={() => setActivePanel("trade")}
              />
              <ShellTab
                active={activePanel === "protect"}
                label="Protect"
                onClick={() => setActivePanel("protect")}
              />
              <ShellTab
                active={activePanel === "activity"}
                label="Activity"
                onClick={() => setActivePanel("activity")}
              />
              <ShellTab
                active={activePanel === "settings"}
                label="Settings"
                onClick={() => setActivePanel("settings")}
              />
            </div>

            <div className="shell-status">
              <span>Kernel {shortenAddress(devnetDeploy.programId)}</span>
              <span>{policy.label}</span>
              <span>{formatPolicySummary(policy)}</span>
            </div>
          </div>

          {activePanel === "trade" ? (
            <div className="trade-panel">
              <div className="trade-grid">
                {/* LEFT: Swap form only */}
                <div className="trade-form-col">
                  <form className="cow-form" onSubmit={handleEvaluateRoutes}>
                    <div className="swap-box">
                      <div className="swap-box-label">You sell</div>
                      <div className="swap-box-row">
                        <input
                          className="swap-amount-input"
                          value={form.amount}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, amount: event.target.value }))
                          }
                        />
                        <select
                          className="swap-token-select"
                          value={form.inputMint}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, inputMint: event.target.value }))
                          }
                        >
                          {tokenChoices().map((token) => (
                            <option key={token.mint} value={token.mint}>
                              {token.symbol}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <button type="button" className="switch-orb" onClick={flipPair}>
                      ⇅
                    </button>

                    <div className="swap-box">
                      <div className="swap-box-label">You buy</div>
                      <div className="swap-box-row">
                        <div className="swap-readout">
                          {comparison
                            ? formatAtomic(
                                (comparison.executionTarget === "safe"
                                  ? comparison.safeQuote?.outAmount
                                  : comparison.baseQuote.outAmount) ?? "0",
                                form.outputMint
                              )
                            : "Protected receive"}
                        </div>
                        <select
                          className="swap-token-select"
                          value={form.outputMint}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, outputMint: event.target.value }))
                          }
                        >
                          {tokenChoices().map((token) => (
                            <option key={token.mint} value={token.mint}>
                              {token.symbol}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="slippage-inline">
                      <span>Slippage</span>
                      <SlippageField
                        value={form.slippageBps}
                        onChange={(value) =>
                          setForm((current) => ({ ...current, slippageBps: value }))
                        }
                      />
                    </div>

                    <button className="primary-button trade-submit" type="submit" disabled={isEvaluating}>
                      {isEvaluating ? "Checking route safety..." : "Check route safety"}
                    </button>
                  </form>

                  <div className="trade-chip-row">
                    <span className="trade-chip">{safeMode ? "safe mode" : "price mode"}</span>
                    <span className="trade-chip">{panicMode ? "panic armed" : "panic idle"}</span>
                    <span className="trade-chip">{form.slippageBps} bps</span>
                  </div>
                </div>

                {/* RIGHT: Route analysis */}
                <div className="trade-info-col">
                  <div className="trade-info-header">
                    <div>
                      <span className="panel-kicker">Execution</span>
                      <h2>Protected swap</h2>
                    </div>
                    <div className="mini-metrics">
                      <MiniMetric label="Mode" value={dataMode === "demo" ? "Demo" : "Live"} />
                      <MiniMetric label="Policy" value={policyPreset} />
                    </div>
                  </div>

                  <div className="compact-route-grid">
                    <CompactRouteCard
                      title="Best price"
                      status={comparison?.baseAssessment.status ?? "warn"}
                      outputLabel={
                        comparison
                          ? formatAtomic(comparison.baseQuote.outAmount, comparison.baseQuote.outputMint)
                          : "not loaded"
                      }
                      detail="Raw market route"
                    />
                    <CompactRouteCard
                      title="Safer route"
                      status={comparison?.safeAssessment?.status ?? "warn"}
                      outputLabel={
                        comparison?.safeQuote
                          ? formatAtomic(comparison.safeQuote.outAmount, comparison.safeQuote.outputMint)
                          : "not loaded"
                      }
                      detail="Flint-filtered fallback"
                    />
                  </div>

                  <div className="trade-summary-bar">
                    <SummaryPill
                      label="Target"
                      value={
                        comparison
                          ? comparison.executionTarget === "safe"
                            ? "safer route"
                            : comparison.executionTarget === "base"
                              ? "best route"
                              : "blocked"
                          : "—"
                      }
                    />
                    <SummaryPill label="Kernel" value={shortenAddress(devnetDeploy.programId)} />
                    <SummaryPill label="Policy" value={policy.label} />
                  </div>

                  <ExecutionBar
                    comparison={comparison}
                    dataMode={dataMode}
                    safeMode={safeMode}
                    walletAddress={walletAddress}
                    isExecutingSwap={isExecutingSwap}
                    onExecuteBase={() => void handleExecuteSwap("base")}
                    onExecuteSafe={() => void handleExecuteSwap("safe")}
                    canExecuteBase={canExecuteBase}
                    canExecuteSafe={canExecuteSafe}
                  />

                  <RiskExplanation comparison={comparison} />
                </div>
              </div>
            </div>
          ) : null}

          {activePanel === "protect" ? (
            <div className="protect-panel">
              <div className="protect-header">
                <div>
                  <span className="panel-kicker">Panic desk</span>
                  <h2>Collect risky orders and clear them before liquidity breaks</h2>
                </div>
                <button className="ghost-button" onClick={() => void handleLoadOrders()}>
                  {isLoadingOrders
                    ? "Refreshing..."
                    : dataMode === "demo"
                      ? "Load demo orders"
                      : "Refresh open orders"}
                </button>
              </div>

              <div className="panic-summary">
                <MetricCard
                  label="Wallet"
                  value={
                    dataMode === "demo"
                      ? "simulated"
                      : walletAddress
                        ? shortenAddress(walletAddress)
                        : "none"
                  }
                />
                <MetricCard label="Open orders" value={String(orders.length)} />
                <MetricCard
                  label="Cancel candidates"
                  value={String(orderAssessments.filter((item) => item.candidate).length)}
                />
                <MetricCard
                  label="Selected"
                  value={String(selectedOrderKeys.length)}
                  detail={panicMode ? "panic mode ready" : "enable panic mode to arm"}
                />
              </div>

              <div className="protect-config">
                <ModeToggle
                  dataMode={dataMode}
                  onChange={handleDataModeChange}
                  activeScenarioId={demoScenario}
                  onScenarioChange={activateDemoScenario}
                />
                <PresetToggle
                  preset={policyPreset}
                  onChange={setPolicyPreset}
                  safeMode={safeMode}
                  onToggleSafeMode={setSafeMode}
                  panicMode={panicMode}
                  onTogglePanicMode={setPanicMode}
                />
              </div>

              <div className="signal-panel">
                <div className="signal-head">
                  <strong>Panic signals</strong>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={addCurrentPairSignal}
                  >
                    Flag current pair
                  </button>
                </div>
                <div className="signal-controls">
                  <InlineAdder
                    label="Token mint"
                    value={signalDrafts.token}
                    placeholder="Mint to hard-block"
                    onChange={(value) =>
                      setSignalDrafts((current) => ({ ...current, token: value }))
                    }
                    onAdd={() => addSignal("token")}
                  />
                  <InlineAdder
                    label="Venue"
                    value={signalDrafts.venue}
                    placeholder="venue label e.g. raydium"
                    onChange={(value) =>
                      setSignalDrafts((current) => ({ ...current, venue: value }))
                    }
                    onAdd={() => addSignal("venue")}
                  />
                </div>
                <SignalChips
                  title="Flagged tokens"
                  values={signals.tokens}
                  onRemove={(value) => removeSignal("tokens", value)}
                />
                <SignalChips
                  title="Flagged pairs"
                  values={signals.pairs}
                  onRemove={(value) => removeSignal("pairs", value)}
                />
                <SignalChips
                  title="Flagged venues"
                  values={signals.venues}
                  onRemove={(value) => removeSignal("venues", value)}
                />
              </div>

              <OrderTable
                assessments={orderAssessments}
                ordersLoaded={ordersLoaded}
                dataMode={dataMode}
                selectedOrderKeys={selectedOrderKeys}
                onToggle={toggleOrderSelection}
              />

              <div className="panic-actions">
                <button
                  className="primary-button"
                  disabled={
                    (dataMode === "live" && !walletAddress) ||
                    !panicMode ||
                    !selectedOrderKeys.length ||
                    isCancellingOrders
                  }
                  onClick={() => void handleCancelOrders()}
                >
                  {isCancellingOrders
                    ? "Submitting cancels..."
                    : dataMode === "demo"
                      ? "Simulate panic cancel"
                      : "One-click panic cancel"}
                </button>
                <p className="muted-copy">
                  {dataMode === "demo"
                    ? "Seeded orders let you show the panic workflow even if no live trigger orders exist."
                    : "Flint uses Jupiter Trigger cancel transactions, then asks the connected wallet to sign and submit them on mainnet."}
                </p>
              </div>
            </div>
          ) : null}

          {activePanel === "activity" ? (
            <div className="activity-panel">
              <section className="proof-strip">
                <ProofCard
                  title="Flint kernel proof"
                  detail={`Program ${shortenAddress(devnetDeploy.programId)} is deployed on devnet with real happy and timeout smoke artifacts.`}
                  href={devnetDeploy.programExplorer}
                  cta="Open program"
                />
                <ProofCard
                  title="Happy path proof"
                  detail={`submit_intent -> submit_bid -> settle_auction completed on devnet: ${shortenAddress(devnetHappy.terminalSignature)}`}
                  href={devnetHappy.terminalExplorer}
                  cta="Open settle tx"
                />
                <ProofCard
                  title="Timeout recovery proof"
                  detail={`refund_after_timeout completed on devnet: ${shortenAddress(devnetTimeout.terminalSignature)}`}
                  href={devnetTimeout.terminalExplorer}
                  cta="Open refund tx"
                />
                <ProofCard
                  title="Submission posture"
                  detail="Use seeded demo first, then switch to live APIs to prove the route and wallet path."
                />
              </section>

              <section className="logs-grid">
                <LogPanel
                  title="Activity log"
                  description="Every route fetch, wallet action, and transaction submission."
                  entries={activityLog}
                />
                <LogPanel
                  title="Incident log"
                  description="Only blocked routes, panic signals, and failed executions."
                  entries={incidentLog}
                />
              </section>
            </div>
          ) : null}

          {activePanel === "settings" ? (
            <div className="settings-panel">
              <div className="hero-grid compact">
                <MetricCard label="Data mode" value={dataMode === "demo" ? "Seeded demo" : "Live APIs"} />
                <MetricCard
                  label="Flint kernel"
                  value="Devnet verified"
                  detail={shortenAddress(devnetDeploy.programId)}
                />
                <MetricCard label="Swap execution path" value="Jupiter Metis" />
                <MetricCard label="Panic order path" value="Jupiter Trigger V1" />
                <MetricCard label="Policy" value={policy.label} detail={formatPolicySummary(policy)} />
                <MetricCard label="Current panel" value={activePanel} />
              </div>
            </div>
          ) : null}
        </section>

        <CanyonLandscape />
      </section>
    </div>
  );
}

/*
 * ICON OPTIONS — pick one by changing which component is used below.
 * FlintMarkA: Arrowhead (knapped flint tool, most literal)
 * FlintMarkB: Crystal facets (mineral/gem structure)
 * FlintMarkC: Shield badge with F lettermark
 */

function FlintMarkA() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Arrowhead body */}
      <path d="M20 4 L33 17 L28 21 L22 38 L20 35 L18 38 L12 21 L7 17 Z"
        fill="#c86020" stroke="#f08840" strokeWidth="1.2" strokeLinejoin="round"/>
      {/* Left bevel */}
      <path d="M20 4 L7 17 L16 20 Z" fill="#b05018" stroke="none"/>
      {/* Right bevel */}
      <path d="M20 4 L33 17 L24 20 Z" fill="#d87030" stroke="none"/>
      {/* Notch lines */}
      <line x1="12" y1="21" x2="16" y2="24" stroke="#804010" strokeWidth="0.8" strokeLinecap="round" opacity="0.6"/>
      <line x1="28" y1="21" x2="24" y2="24" stroke="#804010" strokeWidth="0.8" strokeLinecap="round" opacity="0.6"/>
      {/* Center ridge */}
      <line x1="20" y1="4" x2="20" y2="35" stroke="#804010" strokeWidth="0.7" opacity="0.35"/>
      {/* Spark at tip */}
      <path d="M20 3 L21.2 0.5 L20 1.8 L18.8 0.5 Z" fill="#f09840"/>
      <path d="M22.5 2.5 L24 1" stroke="#f09840" strokeWidth="0.8" strokeLinecap="round" opacity="0.7"/>
      <path d="M17.5 2.5 L16 1" stroke="#f09840" strokeWidth="0.8" strokeLinecap="round" opacity="0.7"/>
    </svg>
  );
}

function FlintMarkB() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Crystal/mineral hexagonal facets */}
      <path d="M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z"
        fill="#c06028" stroke="#e88040" strokeWidth="1.2" strokeLinejoin="round"/>
      {/* Top facet - lighter */}
      <path d="M20 3 L34 11 L20 16 L6 11 Z" fill="#d87030" stroke="none"/>
      {/* Bottom left facet - darker */}
      <path d="M6 11 L20 16 L6 29 Z" fill="#a04e20" stroke="none"/>
      {/* Center line */}
      <line x1="20" y1="3" x2="20" y2="37" stroke="#804018" strokeWidth="0.7" opacity="0.30"/>
      {/* Horizontal equator line */}
      <line x1="6" y1="20" x2="34" y2="20" stroke="#804018" strokeWidth="0.7" opacity="0.25"/>
      {/* Glint / spark top-right */}
      <path d="M31 7 L33 5 L31 6 L29 5 Z" fill="#f8a040"/>
      <circle cx="31" cy="7" r="1.5" fill="#ffbf60" opacity="0.90"/>
      <line x1="33" y1="5" x2="35" y2="3" stroke="#f8a040" strokeWidth="0.7" strokeLinecap="round" opacity="0.6"/>
      <line x1="33" y1="7" x2="36" y2="7" stroke="#f8a040" strokeWidth="0.7" strokeLinecap="round" opacity="0.5"/>
    </svg>
  );
}

function FlintMarkC() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Shield / badge shape */}
      <path d="M7 7 L33 7 L33 27 L20 37 L7 27 Z"
        fill="#b85818" stroke="#e07830" strokeWidth="1.2" strokeLinejoin="round"/>
      {/* Inner lighter area */}
      <path d="M10 10 L30 10 L30 25 L20 33 L10 25 Z" fill="#c86828" stroke="none"/>
      {/* F letterform */}
      <path d="M14 14 L26 14" stroke="#fde8cc" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M14 14 L14 26" stroke="#fde8cc" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M14 20 L23 20" stroke="#fde8cc" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Spark top-right corner */}
      <path d="M30 5 L32 3 L30 4 L28 3 Z" fill="#f09030"/>
      <line x1="32" y1="3" x2="34" y2="1" stroke="#f09030" strokeWidth="0.8" strokeLinecap="round" opacity="0.7"/>
      <line x1="33" y1="5" x2="35" y2="5" stroke="#f09030" strokeWidth="0.8" strokeLinecap="round" opacity="0.5"/>
    </svg>
  );
}

/* Active icon — change to FlintMarkB or FlintMarkC to try the others */
function FlintMark() {
  // Options: FlintMarkA (arrowhead), FlintMarkB (crystal), FlintMarkC (shield badge)
  return <FlintMarkA />;
}

// Keep unused variants accessible — swap above to try them
export { FlintMarkB, FlintMarkC };

function ShellTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`shell-tab ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompactRouteCard({
  title,
  status,
  outputLabel,
  detail,
}: {
  title: string;
  status: "safe" | "warn" | "blocked";
  outputLabel: string;
  detail: string;
}) {
  return (
    <div className="compact-route-card">
      <div className="compact-route-head">
        <strong>{title}</strong>
        <span className={`status-tag ${statusTone(status)}`}>{status}</span>
      </div>
      <div className="compact-route-value">{outputLabel}</div>
      <p>{detail}</p>
    </div>
  );
}

function ExecutionBar({
  comparison,
  dataMode,
  safeMode,
  walletAddress,
  isExecutingSwap,
  onExecuteBase,
  onExecuteSafe,
  canExecuteBase,
  canExecuteSafe,
}: {
  comparison: QuoteComparison | null;
  dataMode: GuardDataMode;
  safeMode: boolean;
  walletAddress: string | null;
  isExecutingSwap: boolean;
  onExecuteBase: () => void;
  onExecuteSafe: () => void;
  canExecuteBase: boolean;
  canExecuteSafe: boolean;
}) {
  return (
    <div className="execution-bar">
      <div>
        <strong>Execution posture</strong>
        <p>
          {comparison
            ? describeComparison(comparison)
            : "No route loaded. Flint will compare the best route against a safety-filtered fallback."}
        </p>
      </div>
      <div className="execution-actions">
        <button className="ghost-button" disabled={!canExecuteBase} onClick={onExecuteBase}>
          {isExecutingSwap
            ? "Sending..."
            : safeMode
              ? "Base route locked"
              : dataMode === "demo"
                ? "Simulate base route"
                : "Execute base route"}
        </button>
        <button className="primary-button" disabled={!canExecuteSafe} onClick={onExecuteSafe}>
          {dataMode === "demo"
            ? "Simulate safer route"
            : walletAddress
              ? "Execute safer route"
              : "Connect wallet to execute"}
        </button>
      </div>
    </div>
  );
}

function RiskExplanation({ comparison }: { comparison: QuoteComparison | null }) {
  const reasons = comparison
    ? comparison.baseAssessment.reasons.concat(comparison.safeAssessment?.reasons ?? [])
    : [];

  return (
    <div className="explanation-panel">
      <div className="panel-header compact">
        <div>
          <span className="panel-kicker">Why Flint rejected the route</span>
          <h3>Risk explanation</h3>
        </div>
      </div>

      {reasons.length ? (
        <div className="reason-list">
          {reasons.map((reason) => (
            <ReasonCard key={reason.id} reason={reason} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <strong>No blockers yet</strong>
          <p>
            Flint will explain blocked venues, weak pools, flagged tokens, panic signals, and
            suspicious route structure here.
          </p>
        </div>
      )}
    </div>
  );
}

function OrderTable({
  assessments,
  ordersLoaded,
  dataMode,
  selectedOrderKeys,
  onToggle,
}: {
  assessments: OrderAssessment[];
  ordersLoaded: boolean;
  dataMode: GuardDataMode;
  selectedOrderKeys: string[];
  onToggle: (orderKey: string) => void;
}) {
  if (!assessments.length) {
    return (
      <div className="empty-state">
        <strong>{ordersLoaded ? "No active trigger orders found" : "No trigger orders loaded yet"}</strong>
        <p>
          {ordersLoaded
            ? "The fetch completed successfully, but there are no orders matching the current wallet or seeded scenario."
            : dataMode === "demo"
              ? "Load seeded demo orders to show the panic workflow."
              : "Connect a wallet, refresh, and Flint will mark panic cancel candidates automatically."}
        </p>
      </div>
    );
  }

  return (
    <div className="order-list">
      {assessments.map((assessment) => (
        <label className="order-card" key={assessment.order.orderKey}>
          <div className="order-head">
            <input
              type="checkbox"
              checked={selectedOrderKeys.includes(assessment.order.orderKey)}
              onChange={() => onToggle(assessment.order.orderKey)}
            />
            <div>
              <strong>
                {tokenByMint(assessment.order.inputMint)?.symbol ?? shortenAddress(assessment.order.inputMint)}
                {" -> "}
                {tokenByMint(assessment.order.outputMint)?.symbol ??
                  shortenAddress(assessment.order.outputMint)}
              </strong>
              <p>{shortenAddress(assessment.order.orderKey)}</p>
            </div>
            <span className={`status-tag ${assessment.candidate ? "alert" : "safe"}`}>
              {assessment.candidate ? "cancel candidate" : "monitor"}
            </span>
          </div>
          <div className="order-metrics">
            <span>make {assessment.order.rawMakingAmount}</span>
            <span>take {assessment.order.rawTakingAmount}</span>
            <span>slippage {assessment.order.slippageBps ?? "n/a"} bps</span>
          </div>
          <div className="order-reasons">
            {assessment.reasons.length ? (
              assessment.reasons.map((reason) => <ReasonChip key={reason.id} reason={reason} />)
            ) : (
              <span className="reason-chip muted">No active panic reason</span>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}

function LogPanel({
  title,
  description,
  entries,
}: {
  title: string;
  description: string;
  entries: ActivityLogEntry[];
}) {
  return (
    <section className="panel">
      <div className="panel-header compact">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {entries.length ? (
        <div className="log-list">
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <article className={`log-row ${entry.severity}`} key={entry.id}>
                <div>
                  <strong>{entry.title}</strong>
                  <p>{entry.detail}</p>
                </div>
                <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
              </article>
            ))}
        </div>
      ) : (
        <div className="empty-state">
          <strong>No log entries yet</strong>
          <p>Flint Guard will persist every quote decision and panic action here.</p>
        </div>
      )}
    </section>
  );
}

function ReasonCard({ reason }: { reason: RouteRiskReason }) {
  return (
    <article className={`reason-card ${reason.blocking ? "blocking" : "warning"}`}>
      <div className="reason-head">
        <strong>{reason.title}</strong>
        <span>{reason.subject}</span>
      </div>
      <p>{reason.detail}</p>
    </article>
  );
}

function ReasonChip({ reason }: { reason: RouteRiskReason }) {
  return (
    <span className={`reason-chip ${reason.blocking ? "blocking" : "warning"}`}>
      {reason.title}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <p>{detail}</p> : null}
    </article>
  );
}

function ProofCard({
  title,
  detail,
  href,
  cta,
}: {
  title: string;
  detail: string;
  href?: string;
  cta?: string;
}) {
  return (
    <article className="proof-card">
      <strong>{title}</strong>
      <p>{detail}</p>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {cta ?? "Open"}
        </a>
      ) : null}
    </article>
  );
}

function SlippageField({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="field">
      <span>Slippage (bps)</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {[30, 50, 75, 100, 150].map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function PresetToggle({
  preset,
  onChange,
  safeMode,
  onToggleSafeMode,
  panicMode,
  onTogglePanicMode,
}: {
  preset: GuardPolicyPreset;
  onChange: (preset: GuardPolicyPreset) => void;
  safeMode: boolean;
  onToggleSafeMode: (next: boolean) => void;
  panicMode: boolean;
  onTogglePanicMode: (next: boolean) => void;
}) {
  return (
    <>
      <div className="preset-group">
        {(["retail", "treasury"] as GuardPolicyPreset[]).map((option) => (
          <button
            key={option}
            className={`chip-button ${preset === option ? "active" : ""}`}
            type="button"
            onClick={() => onChange(option)}
          >
            {POLICY_PRESETS[option].label}
          </button>
        ))}
      </div>
      <ToggleLine
        label="Safe mode"
        description="Block unsafe routes and only allow a safer fallback."
        checked={safeMode}
        onChange={onToggleSafeMode}
      />
      <ToggleLine
        label="Panic mode"
        description="Collect risky open trigger orders as cancel candidates."
        checked={panicMode}
        onChange={onTogglePanicMode}
      />
    </>
  );
}

function ModeToggle({
  dataMode,
  onChange,
  activeScenarioId,
  onScenarioChange,
}: {
  dataMode: GuardDataMode;
  onChange: (next: GuardDataMode) => void;
  activeScenarioId: DemoScenarioId;
  onScenarioChange: (next: DemoScenarioId) => void;
}) {
  return (
    <>
      <div className="preset-group">
        {(["demo", "live"] as GuardDataMode[]).map((mode) => (
          <button
            key={mode}
            className={`chip-button ${dataMode === mode ? "active" : ""}`}
            type="button"
            onClick={() => onChange(mode)}
          >
            {mode === "demo" ? "Seeded demo" : "Live APIs"}
          </button>
        ))}
      </div>
      {dataMode === "demo" ? (
        <div className="demo-scenarios">
          {DEMO_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              className={`scenario-card ${activeScenarioId === scenario.id ? "active" : ""}`}
              onClick={() => onScenarioChange(scenario.id)}
            >
              <strong>{scenario.label}</strong>
              <span>{scenario.summary}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function ToggleLine({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="toggle-line">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function InlineAdder({
  label,
  value,
  placeholder,
  onChange,
  onAdd,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  onAdd: () => void;
}) {
  return (
    <label className="field inline-field">
      <span>{label}</span>
      <div className="inline-adder">
        <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        <button type="button" className="ghost-button" onClick={onAdd}>
          Add
        </button>
      </div>
    </label>
  );
}

function SignalChips({
  title,
  values,
  onRemove,
}: {
  title: string;
  values: string[];
  onRemove: (value: string) => void;
}) {
  return (
    <div className="signal-chip-group">
      <span>{title}</span>
      <div className="chip-wrap">
        {values.length ? (
          values.map((value) => (
            <button key={value} type="button" className="chip-button active" onClick={() => onRemove(value)}>
              {value}
            </button>
          ))
        ) : (
          <span className="muted-copy">none</span>
        )}
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warning" | "critical";
  children: string;
}) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function appendLog(
  setLog: Dispatch<SetStateAction<ActivityLogEntry[]>>,
  input: Omit<ActivityLogEntry, "id" | "createdAt">
) {
  setLog((current) =>
    current.concat({
      ...input,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
    })
  );
}

function rawAmountFromForm(amount: string, mint: string) {
  const token = tokenByMint(mint);
  const decimals = token ? token.decimals : 6;
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Enter a valid positive amount.");
  }
  return String(Math.round(normalized * Math.pow(10, decimals)));
}

function formatAtomic(rawAmount: string, mint: string) {
  const token = tokenByMint(mint);
  const decimals = token ? token.decimals : 6;
  const numeric = Number(rawAmount) / Math.pow(10, decimals);
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${
    token ? token.symbol : ""
  }`.trim();
}

function describeComparison(comparison: QuoteComparison) {
  if (comparison.executionTarget === "safe") {
    return "Base route was blocked. Flint found a safer venue-filtered alternative.";
  }
  if (comparison.executionTarget === "none") {
    return "Base route was blocked and no safer alternative is currently available.";
  }
  return "Best route passed policy. Flint would allow execution on the base route.";
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function CanyonLandscape() {
  return (
    <div className="stage-landscape" aria-hidden="true">
      <svg
        viewBox="0 0 1440 300"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Sky glow — warm orange haze near horizon */}
        <defs>
          <linearGradient id="horizonGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c05810" stopOpacity="0"/>
            <stop offset="100%" stopColor="#7a3010" stopOpacity="0.5"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="1440" height="300" fill="url(#horizonGlow)"/>

        {/* Layer 1 — distant canyon walls, very far back */}
        <path
          d="M0 300 L0 180 Q40 165 90 170 Q140 175 190 155
             Q240 135 300 148 Q360 160 420 138 Q480 116 550 130
             Q620 144 700 118 Q770 92 850 108 Q920 124 1000 100
             Q1070 76 1150 92 Q1220 108 1300 86 Q1380 64 1440 72
             L1440 300 Z"
          fill="#3a1a08"
          opacity="0.9"
        />

        {/* Layer 2 — mid canyon, left butte */}
        <path
          d="M0 300 L0 210 Q50 198 110 205 Q170 212 230 190
             Q270 174 310 188 L310 162 Q322 152 334 155 Q346 158 358 152
             L358 165 Q400 155 450 170 Q500 184 560 165
             Q620 146 680 160 Q740 174 810 155
             Q880 136 950 152 Q1020 168 1090 148
             L1090 126 Q1104 116 1118 120 L1118 148
             Q1170 144 1230 158 Q1300 174 1360 156
             Q1410 142 1440 145 L1440 300 Z"
          fill="#521f08"
          opacity="0.95"
        />

        {/* Layer 3 — near foreground rocks with plateau tops */}
        <path
          d="M0 300 L0 240 Q60 228 130 235 Q200 242 260 222
             Q300 208 340 218 L340 200 Q354 190 368 194 L368 220
             Q430 216 500 228 Q560 240 610 222
             Q650 208 690 218 L690 202 Q702 194 714 198 L714 222
             Q780 218 850 232 Q920 246 970 226
             Q1010 210 1050 224 L1050 204
             Q1066 194 1082 198 Q1098 202 1114 196
             L1114 218 Q1170 210 1230 224
             Q1300 238 1360 220 Q1410 206 1440 210
             L1440 300 Z"
          fill="#6b2a0c"
        />

        {/* Layer 4 — closest foreground, darkest */}
        <path
          d="M0 300 L0 268 Q80 256 160 264 Q240 272 320 256
             Q380 244 440 256 L440 240 Q454 230 468 235 L468 258
             Q540 252 620 264 Q700 276 760 260
             Q800 248 840 260 L840 244
             Q856 234 872 238 L872 262
             Q940 256 1020 268 Q1100 280 1160 264
             Q1220 248 1280 264 L1280 248
             Q1298 238 1316 242 L1316 266
             Q1380 260 1440 264 L1440 300 Z"
          fill="#7a3010"
        />
      </svg>
    </div>
  );
}

function dedupeQuoteAttempts(
  attempts: Array<{ excludeDexes?: string[]; onlyDirectRoutes: boolean }>
) {
  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = JSON.stringify({
      excludeDexes: attempt.excludeDexes ?? [],
      onlyDirectRoutes: attempt.onlyDirectRoutes,
    });
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
