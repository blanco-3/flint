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
            <form className="trade-panel" onSubmit={handleEvaluateRoutes}>
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
                      : "—"}
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
                {comparison ? (
                  <div className="swap-rate-row">
                    <span className="protected-badge">⬡ Protected</span>
                    <span>{policy.label} policy</span>
                  </div>
                ) : null}
              </div>

              {comparison ? (
                <div className="receive-row">
                  <span>You receive</span>
                  <strong>
                    {formatAtomic(
                      (comparison.executionTarget === "safe"
                        ? comparison.safeQuote?.outAmount
                        : comparison.baseQuote.outAmount) ?? "0",
                      form.outputMint
                    )}
                  </strong>
                </div>
              ) : null}

              {!walletAddress && dataMode !== "demo" ? (
                <button
                  type="button"
                  className="primary-button trade-submit"
                  onClick={handleConnectWallet}
                >
                  Connect wallet
                </button>
              ) : comparison ? (
                <button
                  type="button"
                  className="primary-button trade-submit"
                  disabled={isExecutingSwap || (!canExecuteBase && !canExecuteSafe)}
                  onClick={() =>
                    void handleExecuteSwap(
                      comparison.executionTarget === "safe" ? "safe" : "base"
                    )
                  }
                >
                  {isExecutingSwap ? "Confirming..." : "Swap"}
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary-button trade-submit"
                  disabled={isEvaluating}
                >
                  {isEvaluating ? "Finding safe route..." : "Get quote"}
                </button>
              )}
            </form>
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

function Rocky() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Boulder body */}
      <ellipse cx="21" cy="26" rx="16" ry="13" fill="#7a3010"/>
      {/* Rocky top ridge */}
      <path d="M5 26 Q8 19 13 21 Q16 15 19 18 Q21 13 23 16 Q26 12 29 15 Q32 18 35 22 Q37 25 37 26" fill="#8a3814"/>
      {/* Highlight shimmer */}
      <ellipse cx="15" cy="20" rx="6" ry="3.5" fill="#a84e20" opacity="0.5"/>
      {/* Left eye */}
      <circle cx="15" cy="26" r="2.5" fill="#1a0804"/>
      <circle cx="15.9" cy="25.1" r="0.9" fill="white" opacity="0.85"/>
      {/* Right eye */}
      <circle cx="26" cy="26" r="2.5" fill="#1a0804"/>
      <circle cx="26.9" cy="25.1" r="0.9" fill="white" opacity="0.85"/>
      {/* Smile */}
      <path d="M14 31 Q20.5 36 27 31" stroke="#1a0804" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
      {/* Crack detail */}
      <path d="M21 17 L20 22 L22 24" stroke="#4a1606" strokeWidth="0.9" strokeLinecap="round" opacity="0.45"/>
      {/* Sparks */}
      <path d="M30 5 L31.8 1.5 L30.5 4.5 L28 3 Z" fill="#f09030"/>
      <path d="M8 7 L9.2 4 L8.5 6.5 L6.5 5 Z" fill="#f09030"/>
      <circle cx="33" cy="9" r="1.4" fill="#ffbf40" opacity="0.8"/>
      <circle cx="7" cy="11" r="1" fill="#ffbf40" opacity="0.6"/>
    </svg>
  );
}

function FlintMarkA() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M20 4 L33 17 L28 21 L22 38 L20 35 L18 38 L12 21 L7 17 Z"
        fill="#c86020" stroke="#f08840" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M20 4 L7 17 L16 20 Z" fill="#b05018" stroke="none"/>
      <path d="M20 4 L33 17 L24 20 Z" fill="#d87030" stroke="none"/>
      <line x1="12" y1="21" x2="16" y2="24" stroke="#804010" strokeWidth="0.8" strokeLinecap="round" opacity="0.6"/>
      <line x1="28" y1="21" x2="24" y2="24" stroke="#804010" strokeWidth="0.8" strokeLinecap="round" opacity="0.6"/>
      <line x1="20" y1="4" x2="20" y2="35" stroke="#804010" strokeWidth="0.7" opacity="0.35"/>
      <path d="M20 3 L21.2 0.5 L20 1.8 L18.8 0.5 Z" fill="#f09840"/>
    </svg>
  );
}

function FlintMarkB() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M20 3 L34 11 L34 29 L20 37 L6 29 L6 11 Z"
        fill="#c06028" stroke="#e88040" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M20 3 L34 11 L20 16 L6 11 Z" fill="#d87030" stroke="none"/>
      <path d="M6 11 L20 16 L6 29 Z" fill="#a04e20" stroke="none"/>
      <path d="M31 7 L33 5 L31 6 L29 5 Z" fill="#f8a040"/>
      <circle cx="31" cy="7" r="1.5" fill="#ffbf60" opacity="0.90"/>
    </svg>
  );
}

function FlintMarkC() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7 7 L33 7 L33 27 L20 37 L7 27 Z"
        fill="#b85818" stroke="#e07830" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M10 10 L30 10 L30 25 L20 33 L10 25 Z" fill="#c86828" stroke="none"/>
      <path d="M14 14 L26 14" stroke="#fde8cc" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M14 14 L14 26" stroke="#fde8cc" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M14 20 L23 20" stroke="#fde8cc" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="M30 5 L32 3 L30 4 L28 3 Z" fill="#f09030"/>
    </svg>
  );
}

function FlintMark() {
  return <Rocky />;
}

export { FlintMarkA, FlintMarkB, FlintMarkC };

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
        viewBox="0 0 1440 320"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="horizonGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c05810" stopOpacity="0"/>
            <stop offset="100%" stopColor="#7a3010" stopOpacity="0.6"/>
          </linearGradient>
          <radialGradient id="rockyGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f09030" stopOpacity="0.25"/>
            <stop offset="100%" stopColor="#f09030" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="1440" height="320" fill="url(#horizonGlow)"/>

        {/* Layer 1 — distant canyon walls */}
        <path
          d="M0 320 L0 175 Q40 158 90 164 Q140 170 190 148
             Q240 126 300 140 Q360 154 420 130 Q480 106 550 122
             Q620 138 700 110 Q770 82 850 100 Q920 118 1000 92
             Q1070 66 1150 84 Q1220 102 1300 78 Q1380 54 1440 64
             L1440 320 Z"
          fill="#3a1a08" opacity="0.9"
        />

        {/* Layer 2 — mid canyon */}
        <path
          d="M0 320 L0 205 Q50 192 110 198 Q170 205 230 183
             Q270 167 310 181 L310 154 Q322 144 336 148 Q350 152 360 144
             L360 158 Q400 148 450 164 Q500 180 560 158
             Q620 138 680 154 Q740 168 810 148
             Q880 128 950 146 Q1020 162 1090 140
             L1090 118 Q1106 108 1120 112 L1120 142
             Q1172 136 1232 152 Q1302 168 1362 148
             Q1412 134 1440 138 L1440 320 Z"
          fill="#521f08" opacity="0.95"
        />

        {/* Layer 3 — near foreground rocks */}
        <path
          d="M0 320 L0 245 Q60 232 130 238 Q200 245 260 224
             Q300 210 340 220 L340 202 Q355 191 370 196 L370 222
             Q432 218 502 230 Q562 242 612 223
             Q652 208 692 220 L692 203 Q705 193 718 197 L718 224
             Q782 220 852 234 Q922 248 972 228
             Q1012 212 1052 226 L1052 206
             Q1068 196 1084 200 Q1100 204 1116 197
             L1116 220 Q1172 212 1232 226
             Q1302 240 1362 222 Q1412 208 1440 212
             L1440 320 Z"
          fill="#6b2a0c"
        />

        {/* Layer 4 — closest foreground */}
        <path
          d="M0 320 L0 272 Q80 260 160 268 Q240 276 320 260
             Q380 248 440 260 L440 244 Q455 233 470 238 L470 262
             Q542 256 622 268 Q702 280 762 264
             Q802 252 842 264 L842 248
             Q858 237 874 241 L874 266
             Q942 260 1022 272 Q1102 284 1162 268
             Q1222 252 1282 268 L1282 252
             Q1300 241 1318 245 L1318 269
             Q1382 263 1440 267 L1440 320 Z"
          fill="#7a3010"
        />

        {/* Rocky glow halo */}
        <ellipse cx="720" cy="218" rx="70" ry="40" fill="url(#rockyGlow)"/>

        {/* Rocky character — sitting on the center foreground rock */}
        <g transform="translate(720, 215)">
          {/* Shadow under Rocky */}
          <ellipse cx="0" cy="34" rx="30" ry="6" fill="#3a1006" opacity="0.5"/>
          {/* Body boulder */}
          <ellipse cx="0" cy="12" rx="28" ry="24" fill="#6b2a0c"/>
          {/* Rocky top ridge detail */}
          <path d="M-28 12 Q-22 -2 -16 2 Q-10 -8 -4 -3 Q0 -12 4 -5 Q10 -9 16 0 Q22 -3 28 10" fill="#7a3414" stroke="none"/>
          {/* Highlight */}
          <ellipse cx="-10" cy="2" rx="10" ry="6" fill="#904020" opacity="0.45"/>
          {/* Left eye */}
          <circle cx="-10" cy="12" r="4" fill="#1a0804"/>
          <circle cx="-8.4" cy="10.4" r="1.4" fill="white" opacity="0.9"/>
          {/* Right eye */}
          <circle cx="10" cy="12" r="4" fill="#1a0804"/>
          <circle cx="11.6" cy="10.4" r="1.4" fill="white" opacity="0.9"/>
          {/* Smile */}
          <path d="M-10 22 Q0 30 10 22" stroke="#1a0804" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
          {/* Rock crack */}
          <path d="M2 -2 L0 6 L3 10" stroke="#3a1006" strokeWidth="1.2" strokeLinecap="round" opacity="0.5"/>
          {/* Little arm nubs */}
          <ellipse cx="-28" cy="18" rx="8" ry="6" fill="#5a2008"/>
          <ellipse cx="28" cy="18" rx="8" ry="6" fill="#5a2008"/>
          {/* Sparks above */}
          <path d="M-6 -16 L-4 -24 L-5.5 -19 L-9 -21 Z" fill="#f09030"/>
          <path d="M8 -14 L10 -22 L8.5 -17 L5.5 -20 Z" fill="#f09030"/>
          <circle cx="16" cy="-22" r="2.5" fill="#ffbf40" opacity="0.75"/>
          <circle cx="-14" cy="-20" r="2" fill="#ffbf40" opacity="0.65"/>
          <circle cx="2" cy="-27" r="1.5" fill="#ffd060" opacity="0.8"/>
        </g>

        {/* Small rocky pebbles flanking */}
        <g transform="translate(620, 236)">
          <ellipse cx="0" cy="0" rx="14" ry="11" fill="#5a2008"/>
          <ellipse cx="-4" cy="-4" rx="5" ry="3" fill="#7a3414" opacity="0.5"/>
          <circle cx="-4" cy="-1" r="2" fill="#1a0804"/>
          <circle cx="4" cy="-1" r="2" fill="#1a0804"/>
          <circle cx="-3.3" cy="-1.7" r="0.7" fill="white" opacity="0.8"/>
          <circle cx="4.7" cy="-1.7" r="0.7" fill="white" opacity="0.8"/>
          <path d="M-4 4 Q0 7 4 4" stroke="#1a0804" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        </g>
        <g transform="translate(820, 238)">
          <ellipse cx="0" cy="0" rx="12" ry="10" fill="#5a2008"/>
          <ellipse cx="-3" cy="-3" rx="4" ry="2.5" fill="#7a3414" opacity="0.5"/>
          <circle cx="-3" cy="-1" r="1.8" fill="#1a0804"/>
          <circle cx="3" cy="-1" r="1.8" fill="#1a0804"/>
          <circle cx="-2.4" cy="-1.6" r="0.6" fill="white" opacity="0.8"/>
          <circle cx="3.6" cy="-1.6" r="0.6" fill="white" opacity="0.8"/>
          <path d="M-3 4 Q0 6.5 3 4" stroke="#1a0804" strokeWidth="1.3" strokeLinecap="round" fill="none"/>
        </g>
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
