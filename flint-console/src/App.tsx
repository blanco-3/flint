import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

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
  ACTION_PROFILES,
  defaultActionProfileForPreset,
} from "./lib/guard-action";
import { localeCopy, LOCALE_LABELS } from "./lib/guard-locale";
import { deriveModeSessionState } from "./lib/guard-session";
import {
  DEFAULT_SIGNAL_INPUTS,
  POLICY_PRESETS,
  canonicalMint,
  canonicalPairKey,
  canonicalVenue,
  policyCopy,
} from "./lib/guard-policies";
import { buildDeterministicAuditBundle } from "./lib/guard-audit";
import {
  fetchSafetyFeed,
  publishSafetyFeedItem,
} from "./lib/guard-feed-client";
import {
  isSafetyFeedSnapshot,
  parseDeterministicAuditBundle,
} from "./lib/guard-bundle";
import { buildSafetyFeedItem, buildSafetyFeedSnapshot } from "./lib/guard-feed";
import { buildIncidentPack, mergePolicyWithIncident } from "./lib/guard-incident";
import { fetchPoolSnapshots } from "./lib/guard-market-data";
import { buildDecisionReport, buildPanicActionPlan } from "./lib/guard-report";
import { buildWatchSnapshot, buildWatchlistMatches } from "./lib/guard-watch";
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
  type ActionProfileId,
  type DecisionReport,
  type DemoScenarioId,
  type GuardDataMode,
  type GuardPolicyPreset,
  type IncidentPack,
  type LocaleCode,
  type OrderAssessment,
  type PanicActionPlan,
  type QuoteComparison,
  type QuoteFormState,
  type RiskSignalInputs,
  type RouteRiskReason,
  type DeterministicAuditBundle,
  type SafetyFeedItem,
  type SafetyFeedSnapshot,
  type TriggerOrder,
  type WatchlistState,
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
  actionProfile: "flint-guard:action-profile",
  activity: "flint-guard:activity",
  locale: "flint-guard:locale",
  watchlist: "flint-guard:watchlist",
};

const DEFAULT_FORM: QuoteFormState = {
  inputMint: TOKEN_OPTIONS[0].mint,
  outputMint: TOKEN_OPTIONS[1].mint,
  amount: "1",
  slippageBps: 75,
};

export default function App() {
  const [activePanel, setActivePanel] = useState<
    "trade" | "protect" | "watch" | "activity" | "settings"
  >("trade");
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
  const [actionProfileId, setActionProfileId] = usePersistentState<ActionProfileId>(
    STORAGE_KEYS.actionProfile,
    defaultActionProfileForPreset("retail")
  );
  const [locale, setLocale] = usePersistentState<LocaleCode>(STORAGE_KEYS.locale, "en");
  const [signals, setSignals] = usePersistentState<RiskSignalInputs>(
    STORAGE_KEYS.signals,
    DEFAULT_SIGNAL_INPUTS
  );
  const [watchlist, setWatchlist] = usePersistentState<WatchlistState>(
    STORAGE_KEYS.watchlist,
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
  const [feedSnapshot, setFeedSnapshot] = useState<SafetyFeedSnapshot | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [isPublishingFeed, setIsPublishingFeed] = useState(false);
  const [importedBundle, setImportedBundle] = useState<DeterministicAuditBundle | null>(null);
  const [selectedFeedItem, setSelectedFeedItem] = useState<SafetyFeedItem | null>(null);
  const [signalDrafts, setSignalDrafts] = useState({
    token: "",
    venue: "",
  });
  const [watchDrafts, setWatchDrafts] = useState({
    tokens: "",
    pairs: "",
    venues: "",
  });
  const copy = useMemo(() => localeCopy(locale), [locale]);

  const basePolicy = useMemo(() => policyCopy(POLICY_PRESETS[policyPreset]), [policyPreset]);

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

  const incidentPack = useMemo<IncidentPack>(
    () =>
      buildIncidentPack({
        dataMode,
        demoScenario: activeScenario,
        demoScenarioId: demoScenario,
        policyPreset,
        policy: basePolicy,
        safeMode,
        panicMode,
        signals,
        comparison,
      }),
    [
      activeScenario,
      basePolicy,
      comparison,
      dataMode,
      demoScenario,
      panicMode,
      policyPreset,
      safeMode,
      signals,
    ]
  );

  const policy = useMemo(
    () => mergePolicyWithIncident(basePolicy, incidentPack),
    [basePolicy, incidentPack]
  );

  const decisionReport = useMemo<DecisionReport>(
    () =>
      buildDecisionReport({
        actionProfileId,
        incidentPack,
        comparison,
        orderAssessments,
      }),
    [actionProfileId, incidentPack, comparison, orderAssessments]
  );

  const panicActionPlan = useMemo<PanicActionPlan>(
    () =>
      buildPanicActionPlan({
        actionProfileId,
        incidentPack,
        comparison,
        orderAssessments,
      }),
    [actionProfileId, incidentPack, comparison, orderAssessments]
  );

  const auditBundle = useMemo(
    () =>
      buildDeterministicAuditBundle({
        incidentPack,
        decisionReport,
        panicActionPlan,
        comparison,
        ordersLoaded,
        selectedOrderKeys,
        activityLog,
      }),
    [
      incidentPack,
      decisionReport,
      panicActionPlan,
      comparison,
      ordersLoaded,
      selectedOrderKeys,
      activityLog,
    ]
  );

  const safetyFeedPreview = useMemo(
    () =>
      buildSafetyFeedSnapshot([
        buildSafetyFeedItem({
          bundle: auditBundle,
          incidentPack,
          decisionReport,
          panicActionPlan,
          profile: actionProfileId,
        }),
      ]),
    [actionProfileId, auditBundle, decisionReport, incidentPack, panicActionPlan]
  );

  const currentFeedItem = useMemo(
    () =>
      buildSafetyFeedItem({
        bundle: auditBundle,
        incidentPack,
        decisionReport,
        panicActionPlan,
        profile: actionProfileId,
      }),
    [actionProfileId, auditBundle, decisionReport, incidentPack, panicActionPlan]
  );

  const currentWatchItems = useMemo(
    () => (((feedSnapshot?.items ?? []).length > 0 ? feedSnapshot?.items : [currentFeedItem]) ?? []),
    [feedSnapshot, currentFeedItem]
  );

  const watchSnapshot = useMemo(
    () => buildWatchSnapshot(currentWatchItems),
    [currentWatchItems]
  );

  const watchlistMatches = useMemo(
    () => buildWatchlistMatches(watchlist, currentWatchItems),
    [watchlist, currentWatchItems]
  );

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

  async function handleRefreshSafetyFeed() {
    setIsLoadingFeed(true);
    setFeedError(null);
    try {
      const snapshot = await fetchSafetyFeed();
      if (!isSafetyFeedSnapshot(snapshot)) {
        throw new Error("invalid_safety_feed_snapshot");
      }
      setFeedSnapshot(snapshot);
      appendLog(setActivityLog, {
        title: "Safety feed refreshed",
        detail: `${snapshot.itemCount} incident item(s) loaded from relay.`,
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "safety_feed_refresh_failed";
      setFeedError(message);
      appendLog(setActivityLog, {
        title: "Safety feed refresh failed",
        detail: message,
        severity: "warning",
        kind: "incident",
      });
    } finally {
      setIsLoadingFeed(false);
    }
  }

  async function handlePublishSafetyFeed() {
    setIsPublishingFeed(true);
    setFeedError(null);
    try {
      await publishSafetyFeedItem(currentFeedItem);
      appendLog(setActivityLog, {
        title: "Incident published to safety feed",
        detail: currentFeedItem.incidentId,
        severity: "info",
        kind: "activity",
      });
      await handleRefreshSafetyFeed();
    } catch (error) {
      const message = error instanceof Error ? error.message : "safety_feed_publish_failed";
      setFeedError(message);
      appendLog(setActivityLog, {
        title: "Safety feed publish failed",
        detail: message,
        severity: "critical",
        kind: "incident",
      });
    } finally {
      setIsPublishingFeed(false);
    }
  }

  async function handleImportBundle(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = parseDeterministicAuditBundle(JSON.parse(raw));
      setImportedBundle(parsed);
      appendLog(setActivityLog, {
        title: "Incident bundle imported",
        detail: parsed.bundleId,
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "bundle_import_failed";
      setFeedError(message);
      appendLog(setActivityLog, {
        title: "Incident bundle import failed",
        detail: message,
        severity: "critical",
        kind: "incident",
      });
    } finally {
      event.target.value = "";
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

  function addWatchlistItem(kind: keyof WatchlistState) {
    const raw = watchDrafts[kind].trim();
    if (!raw) return;
    setWatchlist((current) => ({
      ...current,
      [kind]: dedupeStrings(current[kind].concat(raw)),
    }));
    setWatchDrafts((current) => ({ ...current, [kind]: "" }));
  }

  function removeWatchlistItem(kind: keyof WatchlistState, value: string) {
    setWatchlist((current) => ({
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
    const nextState = deriveModeSessionState({
      nextMode,
      activeScenario,
      defaultForm: DEFAULT_FORM,
    });
    setForm(nextState.form);
    setSignals(nextState.signals);
    setPolicyPreset(nextState.policyPreset);
    setActionProfileId(nextState.actionProfileId);
  }

  function activateDemoScenario(nextScenario: DemoScenarioId) {
    const scenario = demoScenarioById(nextScenario);
    setDemoScenario(nextScenario);
    setForm(scenario.form);
    setSignals(scenario.signals);
    setPolicyPreset(recommendedDemoPresetForScenario(nextScenario));
    setActionProfileId(
      defaultActionProfileForPreset(recommendedDemoPresetForScenario(nextScenario))
    );
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
    const payload = buildDeterministicAuditBundle({
      incidentPack,
      decisionReport,
      panicActionPlan,
      comparison,
      ordersLoaded,
      selectedOrderKeys,
      activityLog,
    });
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
            <div className="brand-line">{copy.brandLine}</div>
          </div>
        </div>

        <nav className="nav-center-tabs">
          <ShellTab active={activePanel === "trade"} label={copy.tabs.trade} onClick={() => setActivePanel("trade")} />
          <ShellTab active={activePanel === "protect"} label={copy.tabs.protect} onClick={() => setActivePanel("protect")} />
          <ShellTab active={activePanel === "activity"} label={copy.tabs.activity} onClick={() => setActivePanel("activity")} />
          <ShellTab active={activePanel === "watch"} label={copy.tabs.watch} onClick={() => setActivePanel("watch")} />
          <ShellTab active={activePanel === "settings"} label={copy.tabs.settings} onClick={() => setActivePanel("settings")} />
        </nav>

        <div className="nav-actions">
          <div className="lang-toggle">
            {(["en", "kr"] as LocaleCode[]).map((code) => (
              <button
                key={code}
                type="button"
                className={`lang-opt${locale === code ? " active" : ""}`}
                onClick={() => setLocale(code)}
              >
                {LOCALE_LABELS[code]}
              </button>
            ))}
          </div>
          <button type="button" className="ghost-button" onClick={handleResetSession}>
            {copy.nav.reset}
          </button>
          <button type="button" className="ghost-button" onClick={handleExportBundle}>
            {copy.nav.export}
          </button>
          {walletAddress ? (
            <div className="wallet-card">
              <span className="wallet-label">{shortenAddress(walletAddress)}</span>
              <button className="ghost-button" onClick={handleDisconnectWallet}>
                {copy.nav.disconnect}
              </button>
            </div>
          ) : (
            <button className="primary-button" onClick={handleConnectWallet}>
              {copy.nav.connect}
            </button>
          )}
        </div>
      </header>

      <section className="hero-stage">
        <div className="stage-copy">
          <h1>{copy.heroTitle.split("\n").map((line, index) => (<span key={line}>{index ? <br /> : null}{line}</span>))}</h1>
          <p>{copy.heroSubtitle}</p>
        </div>

        {dataMode === "demo" ? (
          <Banner tone="warning">
            {copy.seededBanner}
          </Banner>
        ) : null}

        {walletError ? <Banner tone="warning">{walletError}</Banner> : null}
        {comparisonError ? <Banner tone="critical">{comparisonError}</Banner> : null}
        {orderError ? <Banner tone="warning">{orderError}</Banner> : null}
        {feedError ? <Banner tone="warning">{feedError}</Banner> : null}

        <section className={`trade-shell${activePanel !== "trade" ? " wide-panel" : ""}`}>
          {activePanel !== "trade" ? (
            <div className="shell-header">
              <div className="shell-status">
                <span>Kernel {shortenAddress(devnetDeploy.programId)}</span>
                <span>{policy.label}</span>
                <span>{formatPolicySummary(policy)}</span>
              </div>
            </div>
          ) : null}

          {activePanel === "trade" ? (
            <form className="trade-panel" onSubmit={handleEvaluateRoutes}>

              {/* ── Swap group: sell + orb + buy connected ── */}
              <div className="swap-group">

              {/* Sell box */}
              <div className="swap-box sell-box">
                <div className="swap-box-top">
                  <span className="swap-box-label">{copy.trade.sell}</span>
                  <span className="swap-balance">Balance: —</span>
                </div>
                <div className="swap-box-main">
                  <input
                    className="swap-amount-input"
                    placeholder="0"
                    value={form.amount}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, amount: event.target.value }))
                    }
                  />
                  <select
                    className="token-pill"
                    value={form.inputMint}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, inputMint: event.target.value }))
                    }
                  >
                    {tokenChoices().map((token) => (
                      <option key={token.mint} value={token.mint}>{token.symbol}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Switch orb — glows during route evaluation */}
              <button
                type="button"
                className={`switch-orb${isEvaluating ? " loading" : ""}`}
                onClick={flipPair}
                aria-label="Switch tokens"
              >
                <SwitchArrows />
              </button>

              {/* Buy box */}
              <div className="swap-box buy-box">
                <div className="swap-box-top">
                  <span className="swap-box-label">{copy.trade.buy}</span>
                  <span className="swap-balance">Balance: —</span>
                </div>
                <div className="swap-box-main">
                  <div className={`swap-readout${comparison ? "" : " empty"}`}>
                    {comparison
                      ? formatAtomic(
                          (comparison.executionTarget === "safe"
                            ? comparison.safeQuote?.outAmount
                            : comparison.baseQuote.outAmount) ?? "0",
                          form.outputMint
                        )
                      : "0"}
                  </div>
                  <select
                    className="token-pill"
                    value={form.outputMint}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, outputMint: event.target.value }))
                    }
                  >
                    {tokenChoices().map((token) => (
                      <option key={token.mint} value={token.mint}>{token.symbol}</option>
                    ))}
                  </select>
                </div>
                {comparison ? (
                  <div className="swap-rate-row">
                    <span className="protected-badge">⬡ {copy.trade.protected}</span>
                    <span>{policy.label} policy · {form.slippageBps / 100}% slippage</span>
                  </div>
                ) : null}
              </div>
              </div>{/* end swap-group */}

              {/* ── Slippage row ── */}
              <div className="slippage-row">
                <span>Max slippage</span>
                <select
                  className="slippage-select"
                  value={form.slippageBps}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, slippageBps: Number(event.target.value) }))
                  }
                >
                  {[30, 50, 75, 100, 150].map((v) => (
                    <option key={v} value={v}>{v / 100}%</option>
                  ))}
                </select>
              </div>

              {/* ── Receive row (after quote) ── */}
              {comparison ? (
                <div className="receive-row">
                  <span>{copy.trade.receive}</span>
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

              {/* ── CTA ── */}
              {!walletAddress && dataMode !== "demo" ? (
                <button
                  type="button"
                  className="primary-button trade-submit"
                  onClick={handleConnectWallet}
                >
                  {copy.trade.connectToTrade}
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
                  {isExecutingSwap ? copy.trade.confirming : copy.trade.swap}
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary-button trade-submit"
                  disabled={isEvaluating}
                >
                  {isEvaluating ? copy.trade.findingRoute : copy.trade.getQuote}
                </button>
              )}
            </form>
          ) : null}

          {activePanel === "protect" ? (
            <div className="protect-panel">
              <div className="protect-header">
                <div>
                  <span className="panel-kicker">{copy.protect.kicker}</span>
                  <h2>{copy.protect.title}</h2>
                </div>
                <button className="ghost-button" onClick={() => void handleLoadOrders()}>
                  {isLoadingOrders
                    ? copy.watch.refreshing
                    : dataMode === "demo"
                      ? copy.protect.loadDemoOrders
                      : copy.protect.refreshOrders}
                </button>
              </div>

              <div className="panic-summary">
                <MetricCard
                  label={copy.protect.wallet}
                  value={
                    dataMode === "demo"
                      ? "simulated"
                      : walletAddress
                        ? shortenAddress(walletAddress)
                        : "none"
                  }
                />
                <MetricCard label={copy.protect.openOrders} value={String(orders.length)} />
                <MetricCard
                  label={copy.protect.cancelCandidates}
                  value={String(orderAssessments.filter((item) => item.candidate).length)}
                />
                <MetricCard
                  label={copy.protect.selected}
                  value={String(selectedOrderKeys.length)}
                  detail={panicMode ? copy.protect.panicReady : copy.protect.panicDisabled}
                />
              </div>

              <ActionPlanCard plan={panicActionPlan} labels={copy.cards} />

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
                  <strong>{copy.protect.panicSignals}</strong>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={addCurrentPairSignal}
                  >
                    {copy.protect.flagCurrentPair}
                  </button>
                </div>
                <div className="signal-controls">
                  <InlineAdder
                    label={copy.protect.tokenMint}
                    value={signalDrafts.token}
                    placeholder={copy.protect.tokenPlaceholder}
                    onChange={(value) =>
                      setSignalDrafts((current) => ({ ...current, token: value }))
                    }
                    onAdd={() => addSignal("token")}
                  />
                  <InlineAdder
                    label={copy.protect.venue}
                    value={signalDrafts.venue}
                    placeholder={copy.protect.venuePlaceholder}
                    onChange={(value) =>
                      setSignalDrafts((current) => ({ ...current, venue: value }))
                    }
                    onAdd={() => addSignal("venue")}
                  />
                </div>
                <SignalChips
                  title={copy.protect.flaggedTokens}
                  values={signals.tokens}
                  onRemove={(value) => removeSignal("tokens", value)}
                />
                <SignalChips
                  title={copy.protect.flaggedPairs}
                  values={signals.pairs}
                  onRemove={(value) => removeSignal("pairs", value)}
                />
                <SignalChips
                  title={copy.protect.flaggedVenues}
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
                    ? copy.protect.submitting
                    : dataMode === "demo"
                      ? copy.protect.simulateCancel
                      : copy.protect.oneClickCancel}
                </button>
                <p className="muted-copy">
                  {dataMode === "demo"
                    ? copy.protect.demoHelper
                    : copy.protect.liveHelper}
                </p>
              </div>
            </div>
          ) : null}

          {activePanel === "activity" ? (
            <div className="activity-panel">
              <IncidentPackCard incidentPack={incidentPack} labels={copy.cards} />
              <DecisionReportCard report={decisionReport} labels={copy.cards} />

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
                <ProofCard
                  title="Audit trail"
                  detail={`Incident ${incidentPack.id.split(":").slice(0, 3).join(":")} is exportable as a deterministic bundle.`}
                />
                <ProofCard
                  title="Safety feed preview"
                  detail={`${safetyFeedPreview.itemCount} item · ${safetyFeedPreview.criticalCount} critical · profile ${actionProfileId}`}
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

          {activePanel === "watch" ? (
            <div className="activity-panel">
              <div className="protect-header">
                <div>
                  <span className="panel-kicker">{copy.watch.kicker}</span>
                  <h2>{copy.watch.title}</h2>
                  <p>{copy.watch.subtitle}</p>
                </div>
                <div className="nav-actions compact-actions">
                  <button className="ghost-button" onClick={() => void handleRefreshSafetyFeed()}>
                    {isLoadingFeed ? copy.watch.refreshing : copy.watch.refreshFeed}
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void handlePublishSafetyFeed()}
                    disabled={isPublishingFeed}
                  >
                    {isPublishingFeed ? copy.watch.publishing : copy.watch.publish}
                  </button>
                </div>
              </div>

              <section className="hero-grid compact watch-snapshot-grid">
                <MetricCard label={copy.watch.activeIncidents} value={String(watchSnapshot.activeIncidentCount)} />
                <MetricCard label={copy.watch.criticalIncidents} value={String(watchSnapshot.criticalIncidentCount)} />
                <MetricCard label={copy.watch.degradedIncidents} value={String(watchSnapshot.degradedIncidentCount)} />
                <MetricCard label={copy.watch.blockedRoutes} value={String(watchSnapshot.blockedRouteCount)} />
              </section>

              <div className="proof-strip">
                <ProofCard
                  title={copy.watch.currentIncident}
                  detail={`${incidentPack.name} · ${incidentPack.severity} · ${incidentPack.mode}`}
                />
                <ProofCard
                  title={copy.watch.feedSnapshot}
                  detail={
                    feedSnapshot
                      ? `${feedSnapshot.itemCount} items · ${feedSnapshot.criticalCount} critical`
                      : copy.common.notLoaded
                  }
                />
                <ProofCard
                  title={copy.watch.currentProfile}
                  detail={ACTION_PROFILES[actionProfileId].description}
                />
                <label className="proof-card upload-card">
                  <strong>{copy.watch.importBundle}</strong>
                  <p>{copy.watch.importBody}</p>
                  <input type="file" accept="application/json" onChange={handleImportBundle} />
                </label>
              </div>

              <section className="info-card">
                <span className="panel-kicker">{copy.watch.watchlist}</span>
                <p>{copy.watch.watchlistBody}</p>
                <div className="signal-controls">
                  <InlineAdder
                    label={copy.watch.addToken}
                    value={watchDrafts.tokens}
                    placeholder={copy.protect.tokenPlaceholder}
                    onChange={(value) =>
                      setWatchDrafts((current) => ({ ...current, tokens: value }))
                    }
                    onAdd={() => addWatchlistItem("tokens")}
                  />
                  <InlineAdder
                    label={copy.watch.addPair}
                    value={watchDrafts.pairs}
                    placeholder={copy.watch.pairPlaceholder}
                    onChange={(value) =>
                      setWatchDrafts((current) => ({ ...current, pairs: value }))
                    }
                    onAdd={() => addWatchlistItem("pairs")}
                  />
                </div>
                <div className="signal-controls watch-second-row">
                  <InlineAdder
                    label={copy.watch.addVenue}
                    value={watchDrafts.venues}
                    placeholder={copy.protect.venuePlaceholder}
                    onChange={(value) =>
                      setWatchDrafts((current) => ({ ...current, venues: value }))
                    }
                    onAdd={() => addWatchlistItem("venues")}
                  />
                </div>
                {watchlistMatches.length ? (
                  <div className="feed-list">
                    {watchlistMatches.map((match) => (
                      <article className="feed-item-card" key={`${match.kind}:${match.value}`}>
                        <div className="compact-route-head">
                          <strong>{match.value}</strong>
                          <span className={`status-tag ${match.highestSeverity === "critical" ? "alert" : match.highestSeverity === "elevated" ? "warning" : "safe"}`}>
                            {match.highestSeverity ?? copy.common.none}
                          </span>
                        </div>
                        <p>{match.overlapCount} {copy.watch.overlap}</p>
                        <div className="chip-wrap">
                          {match.kind === "token" ? (
                            <button type="button" className="chip-button" onClick={() => removeWatchlistItem("tokens", match.value)}>× {match.value}</button>
                          ) : null}
                          {match.kind === "pair" ? (
                            <button type="button" className="chip-button" onClick={() => removeWatchlistItem("pairs", match.value)}>× {match.value}</button>
                          ) : null}
                          {match.kind === "venue" ? (
                            <button type="button" className="chip-button" onClick={() => removeWatchlistItem("venues", match.value)}>× {match.value}</button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>{copy.watch.noWatchlist}</strong>
                    <p>{copy.watch.noWatchlistBody}</p>
                  </div>
                )}
              </section>

              {importedBundle ? (
                <>
                  <IncidentPackCard incidentPack={importedBundle.incidentPack} labels={copy.cards} />
                  <DecisionReportCard report={importedBundle.decisionReport} labels={copy.cards} />
                  <ActionPlanCard plan={importedBundle.panicActionPlan} labels={copy.cards} />
                </>
              ) : null}

              <section className="info-card">
                <span className="panel-kicker">{copy.watch.incidentBoard}</span>
                <p>{copy.watch.title}</p>
              </section>

              <section className="feed-list">
                {(feedSnapshot?.items ?? []).length ? (
                  feedSnapshot!.items.map((item) => (
                    <article
                      className={`feed-item-card ${selectedFeedItem?.bundleId === item.bundleId ? "active" : ""}`}
                      key={item.bundleId}
                      onClick={() => setSelectedFeedItem(item)}
                    >
                      <div className="compact-route-head">
                        <strong>{item.headline}</strong>
                        <span className={`status-tag ${item.severity === "critical" ? "alert" : item.posture === "degraded" ? "warning" : "safe"}`}>
                          {item.severity}
                        </span>
                      </div>
                      <p>{item.summary}</p>
                      <div className="report-grid">
                        <SummaryPill label={copy.cards.profile} value={copy.profiles[item.profile]} />
                        <SummaryPill label={copy.cards.execution} value={item.executionRecommendation} />
                        <SummaryPill label={copy.cards.blockedRoute} value={item.blockedRoute ? "yes" : "no"} />
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <strong>{copy.watch.noFeed}</strong>
                    <p>{copy.watch.noFeedBody}</p>
                  </div>
                )}
              </section>

              {selectedFeedItem ? (
                <section className="info-card">
                  <span className="panel-kicker">{copy.watch.selectedIncident}</span>
                  <h2>{selectedFeedItem.headline}</h2>
                  <p>{selectedFeedItem.summary}</p>
                  <div className="report-grid">
                    <SummaryPill label={copy.cards.profile} value={copy.profiles[selectedFeedItem.profile]} />
                    <SummaryPill label={copy.cards.severity} value={selectedFeedItem.severity} />
                    <SummaryPill label={copy.cards.posture} value={selectedFeedItem.posture} />
                    <SummaryPill label={copy.cards.blockedRoute} value={selectedFeedItem.blockedRoute ? "yes" : "no"} />
                  </div>
                  <div className="report-list">
                    <strong>{copy.cards.nextActions}</strong>
                    <ul>
                      {selectedFeedItem.nextActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                </section>
              ) : null}
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
                <MetricCard label="Incident severity" value={incidentPack.severity} />
                <MetricCard label={copy.settings.actionProfile} value={copy.profiles[actionProfileId]} />
              </div>
              <div className="signal-panel">
                <div className="signal-head">
                  <strong>Execution settings</strong>
                </div>
                <SlippageField
                  value={form.slippageBps}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, slippageBps: value }))
                  }
                />
                <div className="preset-group action-profile-group">
                  {(
                    [
                      "retail-user",
                      "treasury-operator",
                      "bot-executor",
                      "partner-app",
                    ] as ActionProfileId[]
                  ).map((profileId) => (
                    <button
                      key={profileId}
                      type="button"
                      className={`chip-button ${actionProfileId === profileId ? "active" : ""}`}
                      onClick={() => setActionProfileId(profileId)}
                    >
                      {ACTION_PROFILES[profileId].label}
                    </button>
                  ))}
                </div>
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
    <svg className="flint-mark" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* Rounded square base — shield-like, like a platform logo */}
      <rect x="3" y="3" width="30" height="30" rx="9" fill="#f07030"/>
      {/* Rocky texture ridge line at top */}
      <path d="M7 14 Q10 9 14 12 Q17 7 20 11 Q23 7 26 11 Q29 8 33 12" stroke="#ff9050" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
      {/* Eyes */}
      <circle cx="13.5" cy="20" r="3" fill="white"/>
      <circle cx="22.5" cy="20" r="3" fill="white"/>
      <circle cx="13.5" cy="20.5" r="1.5" fill="#1a0804"/>
      <circle cx="22.5" cy="20.5" r="1.5" fill="#1a0804"/>
      {/* Smile */}
      <path d="M14 26.5 Q18 30 22 26.5" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

function SwitchArrows() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 3v10M5.5 13l-2.5-2.5M5.5 13l2.5-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12.5 15V5M12.5 5l-2.5 2.5M12.5 5l2.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
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

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function IncidentPackCard({
  incidentPack,
  labels,
}: {
  incidentPack: IncidentPack;
  labels: {
    incidentPack: string;
    recommendedAction: string;
    severity: string;
    source: string;
    mode: string;
    policy: string;
  };
}) {
  return (
    <section className="info-card">
      <span className="panel-kicker">{labels.incidentPack}</span>
      <h2>{incidentPack.name}</h2>
      <p>{incidentPack.summary}</p>
      <div className="report-grid">
        <SummaryPill label={labels.severity} value={incidentPack.severity} />
        <SummaryPill label={labels.source} value={incidentPack.source} />
        <SummaryPill label={labels.mode} value={incidentPack.mode} />
        <SummaryPill label={labels.policy} value={incidentPack.policyPreset} />
      </div>
      <div className="report-list">
        <strong>{labels.recommendedAction}</strong>
        <ul>
          <li>{incidentPack.recommendedAction}</li>
        </ul>
      </div>
    </section>
  );
}

function DecisionReportCard({
  report,
  labels,
}: {
  report: DecisionReport;
  labels: {
    decisionReport: string;
    posture: string;
    execution: string;
    nextActions: string;
  };
}) {
  return (
    <section className="info-card">
      <span className="panel-kicker">{labels.decisionReport}</span>
      <h2>{report.headline}</h2>
      <div className="report-grid">
        <SummaryPill label={labels.posture} value={report.posture} />
        <SummaryPill label={labels.execution} value={report.executionRecommendation} />
      </div>
      <div className="report-copy">
        <p>{report.routeSummary}</p>
        <p>{report.orderSummary}</p>
      </div>
      <div className="report-list">
        <strong>{labels.nextActions}</strong>
        <ul>
          {report.nextActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </div>
      {report.reasons.length ? (
        <div className="reason-list compact">
          {report.reasons.slice(0, 4).map((reason) => (
            <ReasonCard key={reason.id} reason={reason} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ActionPlanCard({
  plan,
  labels,
}: {
  plan: PanicActionPlan;
  labels: {
    panicActionPlan: string;
    severity: string;
    blockedRoute: string;
    candidates: string;
    nextSteps: string;
  };
}) {
  return (
    <section className="info-card action-plan-card">
      <span className="panel-kicker">{labels.panicActionPlan}</span>
      <h2>{plan.summary}</h2>
      <div className="report-grid">
        <SummaryPill label={labels.severity} value={plan.severity} />
        <SummaryPill label={labels.blockedRoute} value={plan.blockedRoute ? "yes" : "no"} />
        <SummaryPill label={labels.candidates} value={String(plan.candidateOrderKeys.length)} />
      </div>
      <div className="report-list">
        <strong>{labels.nextSteps}</strong>
        <ul>
          {plan.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </section>
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
        viewBox="0 0 1440 420"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="skyGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c04c08" stopOpacity="0"/>
            <stop offset="60%" stopColor="#8a2c06" stopOpacity="0.35"/>
            <stop offset="100%" stopColor="#6a2006" stopOpacity="0.7"/>
          </linearGradient>
          <radialGradient id="rockyGlow" cx="50%" cy="70%" r="40%">
            <stop offset="0%" stopColor="#f09030" stopOpacity="0.40"/>
            <stop offset="100%" stopColor="#f09030" stopOpacity="0"/>
          </radialGradient>
          <radialGradient id="sunGlow" cx="50%" cy="0%" r="60%">
            <stop offset="0%" stopColor="#ff8020" stopOpacity="0.25"/>
            <stop offset="100%" stopColor="#ff8020" stopOpacity="0"/>
          </radialGradient>
        </defs>

        {/* Sky gradient fill */}
        <rect x="0" y="0" width="1440" height="420" fill="url(#skyGlow)"/>
        {/* Horizon sun halo */}
        <rect x="0" y="0" width="1440" height="420" fill="url(#sunGlow)"/>

        {/* Left canyon wall */}
        <path
          d="M0 420 L0 60 Q30 40 70 55 Q100 70 130 45 Q160 20 200 38
             Q230 56 260 30 Q280 14 310 28 L310 120
             Q270 130 240 118 Q200 106 160 124 Q120 140 80 128 L80 420 Z"
          fill="#5a2208" opacity="0.95"
        />
        <path
          d="M0 420 L0 140 Q40 126 80 134 Q120 142 160 160 Q200 178 240 165
             Q270 154 310 168 L310 420 Z"
          fill="#7a3212"
        />

        {/* Right canyon wall */}
        <path
          d="M1440 420 L1440 60 Q1410 40 1370 55 Q1340 70 1310 45
             Q1280 20 1240 38 Q1210 56 1180 30 Q1160 14 1130 28
             L1130 120 Q1170 130 1200 118 Q1240 106 1280 124
             Q1320 140 1360 128 L1360 420 Z"
          fill="#5a2208" opacity="0.95"
        />
        <path
          d="M1440 420 L1440 140 Q1400 126 1360 134 Q1320 142 1280 160
             Q1240 178 1200 165 Q1170 154 1130 168 L1130 420 Z"
          fill="#7a3212"
        />

        {/* Layer 1 — distant canyon walls (horizon) */}
        <path
          d="M260 420 L260 130 Q300 108 350 118 Q400 128 460 100
             Q520 72 590 90 Q660 108 730 80 Q800 52 870 72
             Q940 92 1010 68 Q1070 48 1130 62
             L1130 420 Z"
          fill="#4a1e0a" opacity="0.9"
        />

        {/* Layer 2 — mid canyon */}
        <path
          d="M260 420 L260 188 Q300 174 360 180 Q420 186 470 162
             Q510 144 550 160 L550 136 Q562 126 576 130 Q590 134 600 126
             L600 144 Q640 134 690 150 Q740 166 800 144
             Q860 122 920 140 Q980 158 1040 136
             L1040 114 Q1056 104 1070 108 L1070 138
             Q1110 130 1130 144 L1130 420 Z"
          fill="#622410" opacity="0.95"
        />

        {/* Layer 3 — near foreground */}
        <path
          d="M260 420 L260 250 Q320 236 390 244 Q460 252 510 230
             Q550 214 590 228 L590 210 Q606 198 622 204 L622 230
             Q682 224 752 238 Q822 252 872 230
             Q912 214 952 228 L952 210
             Q968 198 984 202 Q1000 206 1016 198
             L1016 224 Q1060 216 1130 232 L1130 420 Z"
          fill="#7e2e12"
        />

        {/* Layer 4 — closest foreground (wide) */}
        <path
          d="M0 420 L0 298 Q80 284 180 292 Q280 300 360 282
             Q420 268 480 282 L480 264 Q496 252 514 258 L514 282
             Q590 274 680 288 Q770 302 840 284
             Q890 270 940 284 L940 266
             Q958 254 976 258 L976 286
             Q1060 278 1160 292 Q1260 306 1360 290
             Q1400 282 1440 278 L1440 420 Z"
          fill="#8e3414"
        />

        {/* Rocky glow halo */}
        <ellipse cx="720" cy="270" rx="90" ry="50" fill="url(#rockyGlow)"/>

        {/* Rocky — new rounded-square design matching nav icon */}
        <g transform="translate(720, 252)">
          {/* Shadow */}
          <ellipse cx="0" cy="42" rx="34" ry="7" fill="#2a0e04" opacity="0.5"/>
          {/* Body — rounded rect like the nav icon */}
          <rect x="-30" y="-28" width="60" height="60" rx="14" fill="#f07030"/>
          {/* Ridge line at top */}
          <path d="M-26 -10 Q-20 -18 -13 -14 Q-7 -22 0 -18 Q7 -22 13 -14 Q20 -18 26 -10"
            stroke="#ff9050" strokeWidth="2" fill="none" strokeLinecap="round"/>
          {/* Left eye */}
          <circle cx="-11" cy="6" r="5" fill="white"/>
          <circle cx="-11" cy="7" r="2.5" fill="#1a0804"/>
          <circle cx="-9.5" cy="5.5" r="1" fill="white" opacity="0.9"/>
          {/* Right eye */}
          <circle cx="11" cy="6" r="5" fill="white"/>
          <circle cx="11" cy="7" r="2.5" fill="#1a0804"/>
          <circle cx="12.5" cy="5.5" r="1" fill="white" opacity="0.9"/>
          {/* Smile */}
          <path d="M-11 18 Q0 26 11 18" stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
          {/* Sparkles above */}
          <path d="M-8 -30 L-6 -40 L-7.5 -34 L-12 -37 Z" fill="#ffd060"/>
          <path d="M8 -28 L10 -38 L8.5 -32 L5 -36 Z" fill="#ffd060"/>
          <circle cx="18" cy="-36" r="3" fill="#ffbf40" opacity="0.80"/>
          <circle cx="-16" cy="-34" r="2.5" fill="#ffbf40" opacity="0.70"/>
          <circle cx="2" cy="-42" r="2" fill="#fff0a0" opacity="0.85"/>
        </g>

        {/* Pebble buddy left */}
        <g transform="translate(560, 276)">
          <rect x="-16" y="-14" width="32" height="28" rx="9" fill="#c05828"/>
          <path d="M-12 -8 Q-7 -13 0 -10 Q7 -13 12 -8" stroke="#d97040" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
          <circle cx="-6" cy="-1" r="3.2" fill="white"/>
          <circle cx="6" cy="-1" r="3.2" fill="white"/>
          <circle cx="-6" cy="-0.5" r="1.6" fill="#1a0804"/>
          <circle cx="6" cy="-0.5" r="1.6" fill="#1a0804"/>
          <path d="M-6 8 Q0 13 6 8" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
        </g>

        {/* Pebble buddy right */}
        <g transform="translate(882, 280)">
          <rect x="-14" y="-12" width="28" height="24" rx="8" fill="#b05020"/>
          <path d="M-10 -6 Q-5 -11 0 -8 Q5 -11 10 -6" stroke="#cc6838" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
          <circle cx="-5" cy="-1" r="2.8" fill="white"/>
          <circle cx="5" cy="-1" r="2.8" fill="white"/>
          <circle cx="-5" cy="-0.5" r="1.4" fill="#1a0804"/>
          <circle cx="5" cy="-0.5" r="1.4" fill="#1a0804"/>
          <path d="M-5 7 Q0 11 5 7" stroke="white" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
        </g>

        {/* Tiny pebble far left */}
        <g transform="translate(390, 296)">
          <rect x="-10" y="-9" width="20" height="18" rx="6" fill="#a04820"/>
          <circle cx="-3.5" cy="-1" r="2.2" fill="white"/>
          <circle cx="3.5" cy="-1" r="2.2" fill="white"/>
          <circle cx="-3.5" cy="-0.5" r="1.1" fill="#1a0804"/>
          <circle cx="3.5" cy="-0.5" r="1.1" fill="#1a0804"/>
          <path d="M-3 5 Q0 8 3 5" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
        </g>

        {/* Tiny pebble far right */}
        <g transform="translate(1060, 290)">
          <rect x="-10" y="-9" width="20" height="18" rx="6" fill="#a84e24"/>
          <circle cx="-3.5" cy="-1" r="2.2" fill="white"/>
          <circle cx="3.5" cy="-1" r="2.2" fill="white"/>
          <circle cx="-3.5" cy="-0.5" r="1.1" fill="#1a0804"/>
          <circle cx="3.5" cy="-0.5" r="1.1" fill="#1a0804"/>
          <path d="M-3 5 Q0 8 3 5" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
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
