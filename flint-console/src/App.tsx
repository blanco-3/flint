import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  buildCancelTransactions,
  fetchPrices,
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
import {
  sortMarketRiskItems,
  summarizeRiskThemes,
  summarizeRiskVenues,
  summarizeTokenHealth,
} from "./lib/guard-market-board";
import { fetchLiveMarketPairs, fetchPoolSnapshots } from "./lib/guard-market-data";
import { buildDecisionReport, buildPanicActionPlan } from "./lib/guard-report";
import { buildPairOnlyWatchRiskItem, buildWatchRiskItem } from "./lib/guard-watch-risk";
import { buildWatchSnapshot } from "./lib/guard-watch";
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
  type MarketRiskItem,
  type MarketRiskTheme,
  type MarketTokenHealth,
  type MarketVenueHealth,
  type OrderAssessment,
  type PanicActionPlan,
  type PoolSnapshot,
  type QuoteComparison,
  type QuoteFormState,
  type RiskSignalInputs,
  type RouteRiskReason,
  type DeterministicAuditBundle,
  type SafetyFeedItem,
  type SafetyFeedSnapshot,
  type TriggerOrder,
} from "./lib/guard-types";
import type { Dispatch, SetStateAction } from "react";
import { TOKEN_OPTIONS, tokenByMint, tokenChoices, type TokenOption } from "./lib/token-options";
import "./index.css";

const STORAGE_KEYS = {
  version: "flint-guard:version",
  dataMode: "flint-guard:data-mode",
  demoScenario: "flint-guard:demo-scenario",
  preset: "flint-guard:preset",
  safeMode: "flint-guard:safe-mode",
  panicMode: "flint-guard:panic-mode",
  signals: "flint-guard:signals",
  actionProfile: "flint-guard:action-profile",
  activity: "flint-guard:activity",
  locale: "flint-guard:locale",
};

const STORAGE_VERSION = "live-product-v2";
const QUOTE_REFRESH_MS = 30000;
const WATCH_REFRESH_MS = 45000;
const PROTECT_REFRESH_MS = 60000;

const DEFAULT_FORM: QuoteFormState = {
  inputMint: TOKEN_OPTIONS[0].mint,
  outputMint: TOKEN_OPTIONS[1].mint,
  amount: "1",
  slippageBps: 75,
};

const AUTO_QUOTE_DEBOUNCE_MS = 900;
const COUNTDOWN_TICK_MS = 5000;

export default function App() {
  const [activePanel, setActivePanel] = useState<
    "trade" | "protect" | "watch" | "activity" | "settings"
  >("watch");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [dataMode, setDataMode] = usePersistentState<GuardDataMode>(
    STORAGE_KEYS.dataMode,
    "live"
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
  const [ordersRefreshedAt, setOrdersRefreshedAt] = useState<string | null>(null);
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
  const [marketBoard, setMarketBoard] = useState<MarketRiskItem[]>([]);
  const [marketTokens, setMarketTokens] = useState<MarketTokenHealth[]>([]);
  const [marketThemes, setMarketThemes] = useState<MarketRiskTheme[]>([]);
  const [marketVenues, setMarketVenues] = useState<MarketVenueHealth[]>([]);
  const [selectedMarketItem, setSelectedMarketItem] = useState<MarketRiskItem | null>(null);
  const [marketBoardError, setMarketBoardError] = useState<string | null>(null);
  const [isLoadingMarketBoard, setIsLoadingMarketBoard] = useState(false);
  const [marketRefreshedAt, setMarketRefreshedAt] = useState<string | null>(null);
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<number | null>(null);
  const [watchExpiresAt, setWatchExpiresAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [isBackgroundRefreshingQuote, setIsBackgroundRefreshingQuote] = useState(false);
  const [tokenSelectorSide, setTokenSelectorSide] = useState<"input" | "output" | null>(null);
  const [tokenSearch, setTokenSearch] = useState("");
  const [showLabControls, setShowLabControls] = useState(false);
  const copy = useMemo(() => localeCopy(locale), [locale]);

  const basePolicy = useMemo(() => policyCopy(POLICY_PRESETS[policyPreset]), [policyPreset]);

  const currentPairKey = useMemo(
    () => canonicalPairKey(form.inputMint, form.outputMint),
    [form.inputMint, form.outputMint]
  );

  const selectedOutputQuote = useMemo(
    () =>
      comparison
        ? comparison.executionTarget === "safe"
          ? comparison.safeQuote ?? comparison.baseQuote
          : comparison.baseQuote
        : null,
    [comparison]
  );

  const selectedAssessment = useMemo(
    () =>
      comparison
        ? comparison.executionTarget === "safe"
          ? comparison.safeAssessment ?? comparison.baseAssessment
          : comparison.baseAssessment
        : null,
    [comparison]
  );

  const selectedInputToken = useMemo(() => tokenByMint(form.inputMint), [form.inputMint]);
  const selectedOutputToken = useMemo(() => tokenByMint(form.outputMint), [form.outputMint]);

  const filteredTokenChoices = useMemo(() => {
    const query = tokenSearch.trim().toLowerCase();
    if (!query) return tokenChoices();
    return tokenChoices().filter((token) => {
      return (
        token.symbol.toLowerCase().includes(query) ||
        token.name.toLowerCase().includes(query) ||
        token.mint.toLowerCase().includes(query)
      );
    });
  }, [tokenSearch]);

  const quoteCountdownSeconds = useMemo(() => {
    if (!quoteExpiresAt) return null;
    return roundCountdownSeconds(quoteExpiresAt - clockNow);
  }, [quoteExpiresAt, clockNow]);

  const watchCountdownSeconds = useMemo(() => {
    if (!watchExpiresAt) return null;
    return roundCountdownSeconds(watchExpiresAt - clockNow);
  }, [watchExpiresAt, clockNow]);

  const heroMarketItem = marketBoard[0] ?? null;
  const secondaryHeatmapItems = marketBoard.slice(1, 8);

  const incidentLog = useMemo(
    () =>
      activityLog.filter((entry) => entry.kind === "incident" || entry.severity !== "info"),
    [activityLog]
  );

  useEffect(() => {
    setComparison(null);
    setComparisonError(null);
    setQuoteExpiresAt(null);
  }, [form.inputMint, form.outputMint, form.amount, form.slippageBps]);

  useEffect(() => {
    const injected = getInjectedWallet();
    if (injected?.publicKey) {
      setWalletAddress(injected.publicKey.toBase58());
    }
  }, [setActionProfileId, setDataMode, setPolicyPreset, setSignals]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEYS.version) === STORAGE_VERSION) return;

    setDataMode("live");
    setActivePanel("watch");
    setSignals(DEFAULT_SIGNAL_INPUTS);
    setPolicyPreset("retail");
    setActionProfileId(defaultActionProfileForPreset("retail"));
    window.localStorage.setItem(STORAGE_KEYS.version, STORAGE_VERSION);
  }, [setActionProfileId, setDataMode, setPolicyPreset, setSignals]);

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

  const refreshWatchSurface = useEffectEvent(() => {
    void handleRefreshMarketBoard(true);
    void handleRefreshSafetyFeed(true);
  });

  const refreshProtectSurface = useEffectEvent(() => {
    void handleLoadOrders();
  });

  const refreshQuoteSurface = useEffectEvent(() => {
    setIsBackgroundRefreshingQuote(true);
    void evaluateLiveRoutes({ background: true })
      .catch(() => {
        setQuoteExpiresAt(Date.now() + QUOTE_REFRESH_MS);
      })
      .finally(() => {
        setIsBackgroundRefreshingQuote(false);
      });
  });

  useEffect(() => {
    if (activePanel !== "watch" || dataMode !== "live") return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (!marketRefreshedAt || !feedSnapshot) {
      refreshWatchSurface();
    }

    const timer = window.setInterval(() => {
      refreshWatchSurface();
    }, WATCH_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [activePanel, dataMode, marketRefreshedAt, feedSnapshot]);

  useEffect(() => {
    if (!feedSnapshot?.items.length) return;
    if (
      !selectedFeedItem ||
      !feedSnapshot.items.some((item) => item.bundleId === selectedFeedItem.bundleId)
    ) {
      setSelectedFeedItem(feedSnapshot.items[0]);
    }
  }, [feedSnapshot, selectedFeedItem]);

  useEffect(() => {
    if (!marketBoard.length) return;
    if (!selectedMarketItem || !marketBoard.some((item) => item.pairKey === selectedMarketItem.pairKey)) {
      setSelectedMarketItem(marketBoard[0]);
    }
  }, [marketBoard, selectedMarketItem]);

  useEffect(() => {
    if (!quoteExpiresAt && !watchExpiresAt) return;
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [quoteExpiresAt, watchExpiresAt]);

  useEffect(() => {
    if (
      activePanel !== "trade" ||
      dataMode !== "live" ||
      (typeof document !== "undefined" && document.visibilityState !== "visible") ||
      !comparison ||
      !quoteExpiresAt ||
      clockNow < quoteExpiresAt ||
      isEvaluating ||
      isBackgroundRefreshingQuote
    ) {
      return;
    }
    refreshQuoteSurface();
  }, [
    activePanel,
    clockNow,
    comparison,
    dataMode,
    isBackgroundRefreshingQuote,
    isEvaluating,
    quoteExpiresAt,
  ]);

  useEffect(() => {
    if (
      activePanel !== "protect" ||
      dataMode !== "live" ||
      (typeof document !== "undefined" && document.visibilityState !== "visible") ||
      !walletAddress ||
      isLoadingOrders
    ) {
      return;
    }
    if (!ordersLoaded) {
      refreshProtectSurface();
    }
    const timer = window.setInterval(() => {
      refreshProtectSurface();
    }, PROTECT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activePanel, dataMode, walletAddress, ordersLoaded, isLoadingOrders]);

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
        title: copy.activity.walletConnected,
        detail: publicKey,
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "wallet_connect_failed";
      setWalletError(message);
      appendLog(setActivityLog, {
        title: copy.activity.walletConnectFailed,
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
      title: copy.activity.walletDisconnected,
      detail: "Cleared live order state.",
      severity: "info",
      kind: "activity",
    });
  }

  const evaluateLiveRoutes = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background ?? false;
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
      baseQuote,
      baseAssessment,
      safeQuote: null,
      safeAssessment: null,
      blockedVenuesUsed: [],
      safeMode,
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

    startTransition(() => {
      setComparison(comparisonState);
      setQuoteExpiresAt(Date.now() + QUOTE_REFRESH_MS);
    });

    if (!background) {
      appendLog(setActivityLog, {
        title: copy.activity.routeUpdated,
        detail: describeComparison(comparisonState),
        severity:
          comparisonState.baseAssessment.status === "blocked" ? "warning" : "info",
        kind:
          comparisonState.baseAssessment.status === "blocked" ? "incident" : "activity",
      });
    }

    return comparisonState;
  }, [copy.activity.routeUpdated, form.amount, form.inputMint, form.outputMint, form.slippageBps, policy, safeMode, setActivityLog]);

  useEffect(() => {
    if (activePanel !== "trade" || dataMode !== "live" || tokenSelectorSide) {
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    if (!form.amount.trim()) {
      setComparison(null);
      setQuoteExpiresAt(null);
      return;
    }
    const numericAmount = Number(form.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsEvaluating(true);
      setComparisonError(null);
      void evaluateLiveRoutes()
        .catch((error) => {
          setComparisonError(describeNetworkError(error, "quote"));
          setQuoteExpiresAt(null);
        })
        .finally(() => {
          setIsEvaluating(false);
        });
    }, AUTO_QUOTE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activePanel,
    dataMode,
    evaluateLiveRoutes,
    form.amount,
    form.inputMint,
    form.outputMint,
    form.slippageBps,
    tokenSelectorSide,
  ]);

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
      await evaluateLiveRoutes();
    } catch (error) {
      const message = describeNetworkError(error, "quote");
      setComparisonError(message);
      appendLog(setActivityLog, {
        title: copy.activity.routeEvaluationFailed,
        detail: message,
        severity: "critical",
        kind: "incident",
      });
      setQuoteExpiresAt(null);
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
        title: copy.activity.swapSubmitted,
        detail: signatures.join(", "),
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "swap_execution_failed";
      appendLog(setActivityLog, {
        title: copy.activity.swapFailed,
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
      setOrdersRefreshedAt(new Date().toISOString());
      setOrderError(null);
      appendLog(setActivityLog, {
        title: copy.activity.ordersLoaded,
        detail: `${response.orders.length} active order(s)`,
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = describeNetworkError(error, "orders");
      setOrderError(message);
      appendLog(setActivityLog, {
        title: copy.activity.ordersFetchFailed,
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

  async function handleRefreshSafetyFeed(background = false) {
    setIsLoadingFeed(true);
    if (!background) {
      setFeedError(null);
    }
    try {
      const snapshot = await fetchSafetyFeed();
      if (!isSafetyFeedSnapshot(snapshot)) {
        throw new Error("invalid_safety_feed_snapshot");
      }
      startTransition(() => {
        setFeedError(null);
        setFeedSnapshot(snapshot);
        setWatchExpiresAt(Date.now() + WATCH_REFRESH_MS);
      });
      if (!background) {
        appendLog(setActivityLog, {
          title: copy.activity.feedRefreshed,
          detail: `${snapshot.itemCount} incident item(s) loaded from relay.`,
          severity: "info",
          kind: "activity",
        });
      }
    } catch {
      const fallback = buildSafetyFeedSnapshot([currentFeedItem]);
      startTransition(() => {
        if (!feedSnapshot?.items.length) {
          setFeedSnapshot(fallback);
        }
        setWatchExpiresAt(Date.now() + WATCH_REFRESH_MS);
      });
      if (!background) {
        appendLog(setActivityLog, {
          title: copy.activity.feedRefreshDegraded,
          detail: "Relay was unavailable. Flint kept the local incident snapshot active.",
          severity: "warning",
          kind: "incident",
        });
      }
    } finally {
      setIsLoadingFeed(false);
    }
  }

  async function handleRefreshMarketBoard(background = false) {
    setIsLoadingMarketBoard(true);
    if (!background) {
      setMarketBoardError(null);
    }
    try {
      const livePairs = await fetchLiveMarketPairs(
        TOKEN_OPTIONS.map((token) => token.mint),
        12
      );
      if (!livePairs.length) {
        throw new Error("market_board_refresh_failed");
      }

      const prices = await fetchPrices(
        dedupeStrings(
          livePairs.flatMap((pair) => [pair.baseToken.address, pair.quoteToken.address])
        )
      );

      const results = await Promise.allSettled(
        livePairs.map(async (pair) => {
          const direction = chooseQuoteDirection(pair);
          if (!direction) {
            throw new Error("market_pair_direction_unavailable");
          }
          const inputToken =
            tokenByMint(direction.inputMint) ??
            syntheticToken(direction.inputMint, direction.inputSymbol);
          const outputToken =
            tokenByMint(direction.outputMint) ??
            syntheticToken(direction.outputMint, direction.outputSymbol);
          const usdPrice = prices[direction.inputMint]?.usdPrice ?? null;
          const amount = sampleQuoteAmount(inputToken, usdPrice);
          try {
            const quote = await fetchQuote({
              inputMint: direction.inputMint,
              outputMint: direction.outputMint,
              amount: rawAmountFromForm(amount, inputToken.mint),
              slippageBps: 75,
            });
            const pools = await fetchPoolSnapshots(quote.routePlan.map((hop) => hop.swapInfo.ammKey));
            const assessment = evaluateQuoteRisk(quote, pools, policy);
            const routeVenues = dedupeStrings(
              quote.routePlan.map((hop) => hop.swapInfo.label || "unknown")
            );
            const primaryPool =
              quote.routePlan[0]?.swapInfo.ammKey
                ? pools[quote.routePlan[0].swapInfo.ammKey]
                : null;
            return {
              ...buildWatchRiskItem({
                inputToken,
                outputToken,
                quote,
                primaryPool: primaryPool ?? pairToPoolSnapshot(pair),
                assessment,
                policy,
                routeVenues,
                hasSafeFallback: assessment.status !== "blocked",
              }),
              poolUrl: primaryPool?.url ?? pair.url ?? null,
            } satisfies MarketRiskItem;
          } catch {
            return buildPairOnlyWatchRiskItem({
              inputToken,
              outputToken,
              primaryPool: pairToPoolSnapshot(pair),
              routeVenues: dedupeStrings([pair.dexId ?? "unknown"]),
              policy,
            });
          }
        })
      );

      const rows = results.reduce<MarketRiskItem[]>((acc, result) => {
        if (result.status === "fulfilled") {
          acc.push(result.value);
        }
        return acc;
      }, []);

      if (!rows.length) {
        throw new Error("market_board_refresh_failed");
      }

      const sorted = sortMarketRiskItems(rows);
      startTransition(() => {
        setMarketBoardError(null);
        setMarketBoard(sorted);
        setMarketTokens(summarizeTokenHealth(sorted));
        setMarketThemes(summarizeRiskThemes(sorted));
        setMarketVenues(summarizeRiskVenues(sorted));
        setMarketRefreshedAt(new Date().toISOString());
        setWatchExpiresAt(Date.now() + WATCH_REFRESH_MS);
      });
      if (!background) {
        appendLog(setActivityLog, {
          title: copy.activity.marketBoardRefreshed,
          detail: `${sorted.length} monitored route(s) rescored.`,
          severity: "info",
          kind: "activity",
        });
      }
    } catch (error) {
      if (!background && !marketBoard.length) {
        setMarketBoardError(describeNetworkError(error, "market"));
      }
      setWatchExpiresAt(Date.now() + WATCH_REFRESH_MS);
      if (!background) {
        appendLog(setActivityLog, {
          title: copy.activity.marketBoardDegraded,
          detail: "Live quotes or pool metadata were unavailable. Flint kept the last board state.",
          severity: "warning",
          kind: "incident",
        });
      }
    } finally {
      setIsLoadingMarketBoard(false);
    }
  }

  async function handlePublishSafetyFeed() {
    setIsPublishingFeed(true);
    setFeedError(null);
    try {
      await publishSafetyFeedItem(currentFeedItem);
      appendLog(setActivityLog, {
        title: copy.activity.incidentPublished,
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
        title: copy.activity.bundleImported,
        detail: parsed.bundleId,
        severity: "info",
        kind: "activity",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "bundle_import_failed";
      setFeedError(message);
      appendLog(setActivityLog, {
        title: copy.activity.bundleImportFailed,
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

  function armProtectFromFeedItem(item: SafetyFeedItem) {
    setSignals((current) => ({
      tokens: dedupeStrings(current.tokens.concat(item.affectedTokens.map(canonicalMint))),
      pairs: dedupeStrings(current.pairs.concat(item.affectedPairs.map(normalizeWatchPair))),
      venues: dedupeStrings(current.venues.concat(item.affectedVenues.map(canonicalVenue))),
    }));
    setPanicMode(true);
    setActivePanel("protect");
    appendLog(setActivityLog, {
      title: copy.activity.protectDeskArmed,
      detail: item.incidentId,
      severity: "warning",
      kind: "incident",
    });
  }

  function removeSignal(kind: keyof RiskSignalInputs, value: string) {
    setSignals((current) => ({
      ...current,
      [kind]: current[kind].filter((item) => item !== value),
    }));
  }

  function selectToken(side: "input" | "output", mint: string) {
    setForm((current) => ({
      ...current,
      inputMint: side === "input" ? mint : current.inputMint,
      outputMint: side === "output" ? mint : current.outputMint,
    }));
    setTokenSelectorSide(null);
    setTokenSearch("");
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
    setQuoteExpiresAt(null);
    setOrders([]);
    setOrdersLoaded(false);
    setOrdersRefreshedAt(null);
    setSelectedOrderKeys([]);
    setOrderError(null);
    setFeedError(null);
    setImportedBundle(null);
    setSelectedFeedItem(null);
    setSelectedMarketItem(null);
    setShowLabControls(false);
    setSignalDrafts({
      token: "",
      venue: "",
    });
    setTokenSelectorSide(null);
    setTokenSearch("");
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
      title: copy.activity.bundleExported,
      detail: "Downloaded the current incident, log, and risk snapshot as JSON.",
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
          <ShellTab active={activePanel === "watch"} label={copy.tabs.watch} onClick={() => setActivePanel("watch")} />
          <ShellTab active={activePanel === "trade"} label={copy.tabs.trade} onClick={() => setActivePanel("trade")} />
          <ShellTab active={activePanel === "protect"} label={copy.tabs.protect} onClick={() => setActivePanel("protect")} />
          <ShellTab active={activePanel === "activity"} label={copy.tabs.activity} onClick={() => setActivePanel("activity")} />
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
        {walletError ? <Banner tone="warning">{walletError}</Banner> : null}
        {comparisonError ? <Banner tone="critical">{comparisonError}</Banner> : null}
        {orderError ? <Banner tone="warning">{orderError}</Banner> : null}
        {feedError ? <Banner tone="warning">{feedError}</Banner> : null}

        <section
          className={`trade-shell${activePanel !== "trade" || (activePanel === "trade" && comparison) ? " wide-panel" : ""}`}
        >
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
            <div className="trade-workbench">
              <form className="trade-panel" onSubmit={handleEvaluateRoutes}>
              {/* ── Swap group: sell + orb + buy connected ── */}
              <div className="swap-group">

              {/* Sell box */}
              <div className="swap-box sell-box">
                <div className="swap-box-top">
                  <span className="swap-box-label">{copy.trade.sell}</span>
                  <span className="swap-balance">{copy.trade.balance}: —</span>
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
                  <TokenSelectButton
                    token={selectedInputToken}
                    copy={copy}
                    onClick={() => setTokenSelectorSide("input")}
                  />
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
                  <span className="swap-balance">{copy.trade.balance}: —</span>
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
                  <TokenSelectButton
                    token={selectedOutputToken}
                    copy={copy}
                    onClick={() => setTokenSelectorSide("output")}
                  />
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
                <span>{copy.trade.maxSlippage}</span>
                <div className="trade-meta-actions">
                  <QuoteCountdownPill
                    countdown={quoteCountdownSeconds}
                    isRefreshing={isEvaluating || isBackgroundRefreshingQuote}
                    label={copy.trade.quoteRefresh}
                    refreshingLabel={copy.trade.quoteRefreshing}
                    readyLabel={copy.trade.quoteIdle}
                  />
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

              <div className="trade-analysis">
                {comparison ? (
                  <>
                    <TradeDecisionCard
                      comparison={comparison}
                      assessment={selectedAssessment}
                      outputQuote={selectedOutputQuote}
                      outputMint={form.outputMint}
                      copy={copy}
                    />
                    <div className="trade-route-grid">
                      <RouteAssessmentCard
                        title={copy.trade.baseRoute}
                        assessment={comparison.baseAssessment}
                        quote={comparison.baseQuote}
                        outputMint={form.outputMint}
                        copy={copy}
                      />
                      {comparison.safeQuote && comparison.safeAssessment ? (
                        <RouteAssessmentCard
                          title={copy.trade.safeRoute}
                          assessment={comparison.safeAssessment}
                          quote={comparison.safeQuote}
                          outputMint={form.outputMint}
                          highlighted={comparison.executionTarget === "safe"}
                          copy={copy}
                        />
                      ) : (
                        <section className="info-card route-card empty-route-card">
                          <span className="panel-kicker">{copy.trade.safeRoute}</span>
                          <h2>{copy.trade.noSafeRouteTitle}</h2>
                          <p>{copy.trade.noSafeRouteBody}</p>
                        </section>
                      )}
                    </div>
                    <section className="info-card trade-hint-card">
                      <span className="panel-kicker">{copy.trade.dataSource}</span>
                      <p>{copy.trade.dataSourceBody}</p>
                    </section>
                  </>
                ) : (
                  <section className="info-card trade-hint-card">
                    <span className="panel-kicker">{copy.trade.liveRouteBoard}</span>
                    <h2>{copy.trade.tradeHintTitle}</h2>
                    <p>{copy.trade.tradeHintBody}</p>
                  </section>
                )}
                <section className="execution-bar trade-source-bar">
                  <div>
                    <strong>{copy.trade.dataSource}</strong>
                    <p>{copy.trade.dataSourceBody}</p>
                  </div>
                  <span className="status-tag safe">{copy.trade.quoteIdle}</span>
                </section>
              </div>
            </div>
          ) : null}

          {activePanel === "protect" ? (
            <div className="protect-panel">
              <div className="protect-header">
                <div>
                  <span className="panel-kicker">{copy.protect.kicker}</span>
                  <h2>{copy.protect.title}</h2>
                  <p>
                    {ordersRefreshedAt
                      ? `${copy.protect.lastUpdated}: ${new Date(ordersRefreshedAt).toLocaleTimeString()} · ${copy.protect.autoRefresh}`
                      : copy.protect.autoRefresh}
                  </p>
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
                      ? copy.common.simulated
                      : walletAddress
                        ? shortenAddress(walletAddress)
                        : copy.common.none
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

              <section className={`execution-bar protect-urgency-bar ${panicMode ? "armed" : "idle"}`}>
                <div>
                  <strong>
                    {panicMode ? copy.protect.responseReadyTitle : copy.protect.responseIdleTitle}
                  </strong>
                  <p>
                    {selectedOrderKeys.length
                      ? `${selectedOrderKeys.length} ${copy.protect.ordersNeedAction}`
                      : copy.protect.responseIdleBody}
                  </p>
                </div>
                <span
                  className={`status-tag ${
                    selectedOrderKeys.length
                      ? "alert"
                      : panicMode
                        ? "warning"
                        : "muted"
                  }`}
                >
                  {selectedOrderKeys.length
                    ? copy.protect.actionRequired
                    : panicMode
                      ? copy.protect.monitoring
                      : copy.protect.armPanicMode}
                </span>
              </section>

              <div className="protect-config">
                <PresetToggle
                  preset={policyPreset}
                  onChange={setPolicyPreset}
                  safeMode={safeMode}
                  onToggleSafeMode={setSafeMode}
                  panicMode={panicMode}
                  onTogglePanicMode={setPanicMode}
                  copy={copy}
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
                copy={copy}
                hasError={Boolean(orderError)}
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
                  title={copy.activity.kernelProof}
                  detail={`${copy.activity.kernelProofBody} Program ${shortenAddress(devnetDeploy.programId)}.`}
                  href={devnetDeploy.programExplorer}
                  cta={copy.common.open}
                />
                <ProofCard
                  title={copy.activity.happyPathProof}
                  detail={`submit_intent -> submit_bid -> settle_auction completed on devnet: ${shortenAddress(devnetHappy.terminalSignature)}`}
                  href={devnetHappy.terminalExplorer}
                  cta={copy.common.open}
                />
                <ProofCard
                  title={copy.activity.timeoutProof}
                  detail={`refund_after_timeout completed on devnet: ${shortenAddress(devnetTimeout.terminalSignature)}`}
                  href={devnetTimeout.terminalExplorer}
                  cta={copy.common.open}
                />
                <ProofCard
                  title={copy.activity.submissionPosture}
                  detail={copy.activity.submissionPostureBody}
                />
                <ProofCard
                  title={copy.activity.auditTrail}
                  detail={`${copy.activity.auditTrailBody} Incident ${incidentPack.id.split(":").slice(0, 3).join(":")}.`}
                />
                <ProofCard
                  title={copy.activity.safetyFeedPreview}
                  detail={`${safetyFeedPreview.itemCount} item · ${safetyFeedPreview.criticalCount} critical · profile ${actionProfileId}`}
                />
              </section>

              <section className="logs-grid">
                <LogPanel
                  title={copy.activity.activityLog}
                  description={copy.activity.activityBody}
                  entries={activityLog}
                  emptyTitle={copy.activity.noActivityYet}
                  emptyBody={copy.activity.noActivityYetBody}
                />
                <LogPanel
                  title={copy.activity.incidentLog}
                  description={copy.activity.incidentBody}
                  entries={incidentLog}
                  emptyTitle={copy.activity.noActivityYet}
                  emptyBody={copy.activity.noActivityYetBody}
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
                  <QuoteCountdownPill
                    countdown={watchCountdownSeconds}
                    isRefreshing={isLoadingFeed || isLoadingMarketBoard}
                    label={copy.watch.refreshCycle}
                    refreshingLabel={copy.watch.refreshing}
                    readyLabel={copy.watch.refreshReady}
                  />
                  <button className="ghost-button" onClick={() => void handleRefreshMarketBoard()}>
                    {copy.watch.snapshot}
                  </button>
                  <button className="ghost-button" onClick={() => void handleRefreshSafetyFeed()}>
                    {copy.watch.refreshFeed}
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

              {marketThemes.length ? (
                <section className="info-card watch-reason-strip">
                  <span className="panel-kicker">{copy.watch.topDrivers}</span>
                  <div className="chip-wrap dense-chip-wrap">
                    {marketThemes.slice(0, 4).map((theme) => (
                      <span
                        key={theme.title}
                        className={`reason-chip ${
                          theme.status === "blocked"
                            ? "blocking"
                            : theme.status === "warn"
                              ? "warning"
                              : "muted"
                        }`}
                      >
                        {theme.title}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {marketBoard.length ? (
                <section className="info-card">
                  <span className="panel-kicker">{copy.watch.heatmapTitle}</span>
                  <p className="heatmap-copy">{copy.watch.heatmapExplain}</p>
                  <div className="watch-heatmap">
                    {heroMarketItem ? (
                      <button
                        key={`heatmap:hero:${heroMarketItem.pairKey}`}
                        type="button"
                        className={`heatmap-tile hero ${heroMarketItem.riskLevel} ${
                          selectedMarketItem?.pairKey === heroMarketItem.pairKey ? " active" : ""
                        }`}
                        onClick={() => setSelectedMarketItem(heroMarketItem)}
                      >
                        <span className="heatmap-eyebrow">{copy.watch.topRiskNow}</span>
                        <div className="heatmap-head">
                          <span className="heatmap-label">{heroMarketItem.pairKey}</span>
                          <span className="heatmap-badge">
                            {heroMarketItem.badge ?? heroMarketItem.riskLevel}
                          </span>
                        </div>
                        <strong>{heroMarketItem.score}</strong>
                        <p>{heroMarketItem.reasonTitles[0] ?? heroMarketItem.riskSummary}</p>
                        <span className="heatmap-venue">
                          {heroMarketItem.venues[0] ?? heroMarketItem.venue}
                        </span>
                        <span className="heatmap-confidence">
                          {formatConfidence(heroMarketItem.dataConfidence, copy)}
                        </span>
                      </button>
                    ) : null}

                    {secondaryHeatmapItems.map((item) => (
                      <button
                        key={`heatmap:${item.pairKey}`}
                        type="button"
                        className={`heatmap-tile ${item.riskLevel} ${item.importanceBucket}${
                          selectedMarketItem?.pairKey === item.pairKey ? " active" : ""
                        }`}
                        onClick={() => setSelectedMarketItem(item)}
                      >
                        <div className="heatmap-head">
                          <span className="heatmap-label">{item.pairKey}</span>
                          <span className="heatmap-badge">{item.badge ?? item.riskLevel}</span>
                        </div>
                        <strong>{item.score}</strong>
                        <p>{item.reasonTitles[0] ?? item.riskSummary}</p>
                        <span className="heatmap-venue">{item.venues[0] ?? item.venue}</span>
                        <span className="heatmap-confidence">
                          {formatConfidence(item.dataConfidence, copy)}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="info-card">
                <span className="panel-kicker">{copy.watch.livePoolBoard}</span>
                <p>
                  {marketRefreshedAt
                    ? `${copy.watch.lastUpdated}: ${new Date(marketRefreshedAt).toLocaleTimeString()}`
                    : copy.common.notLoaded}
                </p>
                {marketBoard.length ? (
                  <div className="leaderboard-list">
                    {marketBoard.map((item, index) => (
                      <LeaderboardRow
                        key={item.pairKey}
                        rank={index + 1}
                        title={item.pairKey}
                        subtitle={`${item.venues.join(" · ")} · ${copy.trade.routeScore} ${item.score}`}
                        status={item.status}
                        detail={
                          typeof item.priceImpactPct === "number" && Number.isFinite(item.priceImpactPct)
                            ? `${copy.trade.priceImpact} ${item.priceImpactPct.toFixed(2)}%`
                            : formatConfidence(item.dataConfidence, copy)
                        }
                        chips={
                          item.reasonTitles.length
                            ? [formatConfidence(item.dataConfidence, copy), ...item.reasonTitles]
                            : [formatConfidence(item.dataConfidence, copy), copy.watch.clearNow]
                        }
                        linkLabel={item.poolUrl ? copy.watch.openPool : undefined}
                        linkHref={item.poolUrl ?? undefined}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>{copy.watch.noFeed}</strong>
                    <p>{marketBoardError ?? copy.watch.noFeedBody}</p>
                  </div>
                )}
              </section>

              <section className="info-card">
                <span className="panel-kicker">{copy.watch.assetHealth}</span>
                <p>{copy.watch.assetHealthBody}</p>
                {marketTokens.length ? (
                  <div className="leaderboard-list compact">
                    {marketTokens.map((asset, index) => (
                      <LeaderboardRow
                        key={asset.symbol}
                        rank={index + 1}
                        title={asset.symbol}
                        subtitle={`${asset.pairCount} ${copy.watch.monitoredPairs} · ${asset.venueCount} ${copy.watch.monitoredVenues}`}
                        status={asset.status}
                        detail={`${copy.watch.assetScore} ${asset.averageScore}`}
                        chips={asset.topReasons.length ? asset.topReasons : [copy.watch.clearNow]}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>{copy.watch.noFeed}</strong>
                    <p>{copy.watch.noFeedBody}</p>
                  </div>
                )}
              </section>

              <section className="info-card">
                <span className="panel-kicker">{copy.watch.venuePressure}</span>
                <p>{copy.watch.riskThemesBody}</p>
                {marketVenues.length ? (
                  <div className="leaderboard-list compact">
                    {marketVenues.map((venue, index) => (
                      <LeaderboardRow
                        key={venue.venue}
                        rank={index + 1}
                        title={venue.venue}
                        subtitle={`${venue.count} ${copy.watch.venueRoutes}`}
                        status={venue.status}
                        detail={`${venue.blockedCount} ${copy.watch.blockedNow}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>{copy.watch.venuePressure}</strong>
                    <p>{copy.common.notLoaded}</p>
                  </div>
                )}
              </section>

              {selectedMarketItem ? (
                <section className="info-card">
                  <span className="panel-kicker">{copy.watch.selectedPoolDetail}</span>
                  <h2>{selectedMarketItem.pairKey}</h2>
                  <p>{selectedMarketItem.riskSummary}</p>
                  <div className="report-grid">
                    <SummaryPill label={copy.watch.riskScore} value={String(selectedMarketItem.score)} />
                    <SummaryPill label={copy.watch.riskLevel} value={selectedMarketItem.riskLevel} />
                    <SummaryPill label={copy.watch.importance} value={selectedMarketItem.importanceBucket} />
                    <SummaryPill
                      label={copy.watch.confidence}
                      value={formatConfidence(selectedMarketItem.dataConfidence, copy)}
                    />
                    <SummaryPill
                      label={copy.watch.marketStatus}
                      value={selectedMarketItem.badge ?? selectedMarketItem.status}
                    />
                  </div>
                  <div className="report-list">
                    <strong>{copy.cards.nextActions}</strong>
                    <ul>
                      <li>{selectedMarketItem.nextAction}</li>
                    </ul>
                  </div>
                  <div className="reason-list compact">
                    {selectedMarketItem.factors.slice(0, 4).map((factor) => (
                      <article className="reason-card warning" key={`${selectedMarketItem.pairKey}:${factor.id}`}>
                        <div className="reason-head">
                          <strong>{factor.title}</strong>
                          <span>{factor.score}</span>
                        </div>
                        <p>{factor.detail}</p>
                      </article>
                    ))}
                  </div>
                  <div className="execution-actions watch-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setForm((current) => ({
                          ...current,
                          inputMint: selectedMarketItem.inputMint,
                          outputMint: selectedMarketItem.outputMint,
                        }));
                        setActivePanel("trade");
                      }}
                    >
                      {copy.watch.openTrade}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        setSignals((current) => ({
                          ...current,
                          pairs: dedupeStrings(
                            current.pairs.concat(
                              canonicalPairKey(selectedMarketItem.inputMint, selectedMarketItem.outputMint)
                            )
                          ),
                        }));
                        setPanicMode(true);
                        setActivePanel("protect");
                      }}
                    >
                      {copy.watch.openProtectDesk}
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="hero-grid compact watch-status-rail">
                <MetricCard
                  label={copy.watch.currentIncident}
                  value={incidentPack.severity}
                  detail={incidentPack.name}
                />
                <MetricCard
                  label={copy.watch.feedSnapshot}
                  value={feedSnapshot ? String(feedSnapshot.itemCount) : copy.common.none}
                  detail={
                    feedSnapshot
                      ? `${feedSnapshot.criticalCount} critical`
                      : copy.common.notLoaded
                  }
                />
                <MetricCard
                  label={copy.watch.currentProfile}
                  value={copy.profiles[actionProfileId]}
                  detail={ACTION_PROFILES[actionProfileId].description}
                />
                <MetricCard
                  label={copy.watch.marketStatus}
                  value={marketRefreshedAt ? copy.watch.refreshReady : copy.common.none}
                  detail={
                    marketRefreshedAt
                      ? `${copy.watch.lastUpdated}: ${new Date(marketRefreshedAt).toLocaleTimeString()}`
                      : copy.common.notLoaded
                  }
                />
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
                        <SummaryPill label={copy.cards.blockedRoute} value={item.blockedRoute ? copy.common.yes : copy.common.no} />
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
                    <SummaryPill label={copy.cards.blockedRoute} value={selectedFeedItem.blockedRoute ? copy.common.yes : copy.common.no} />
                  </div>
                  <div className="report-list">
                    <strong>{copy.cards.nextActions}</strong>
                    <ul>
                      {selectedFeedItem.nextActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="execution-actions watch-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => armProtectFromFeedItem(selectedFeedItem)}
                    >
                      {copy.watch.openProtectDesk}
                    </button>
                  </div>
                </section>
              ) : null}

            </div>
          ) : null}

          {activePanel === "settings" ? (
            <div className="settings-panel">
              <div className="hero-grid compact">
                <MetricCard label={copy.common.dataMode} value={dataMode === "demo" ? copy.common.labMode : copy.common.liveApis} />
                <MetricCard
                  label={copy.settings.kernelLabel}
                  value={copy.settings.verifiedValue}
                  detail={shortenAddress(devnetDeploy.programId)}
                />
                <MetricCard label={copy.settings.executionPath} value="Jupiter Metis" />
                <MetricCard label={copy.settings.panicPath} value="Jupiter Trigger V1" />
                <MetricCard label={copy.settings.policyLabel} value={policy.label} detail={formatPolicySummary(policy)} />
                <MetricCard label={copy.common.currentPanel} value={activePanel} />
                <MetricCard label={copy.settings.incidentSeverity} value={incidentPack.severity} />
                <MetricCard label={copy.settings.actionProfile} value={copy.profiles[actionProfileId]} />
              </div>
              <div className="signal-panel">
                <div className="signal-head">
                  <strong>{copy.settings.executionSettings}</strong>
                </div>
                <SlippageField
                  value={form.slippageBps}
                  label={copy.trade.maxSlippage}
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
                      {copy.profiles[profileId]}
                    </button>
                  ))}
                </div>
              </div>

              <section className="info-card">
                <div className="compact-route-head">
                  <span className="panel-kicker">{copy.settings.labControls}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setShowLabControls((current) => !current)}
                  >
                    {showLabControls ? copy.settings.hideLab : copy.settings.showLab}
                  </button>
                </div>
                {showLabControls ? (
                  <>
                    <ModeToggle
                      dataMode={dataMode}
                      onChange={handleDataModeChange}
                      activeScenarioId={demoScenario}
                      onScenarioChange={activateDemoScenario}
                      labels={copy.common}
                    />
                    <h2>{copy.watch.importBundle}</h2>
                    <p>{copy.watch.importBody}</p>
                    <label className="proof-card upload-card settings-upload-card">
                      <strong>{copy.watch.importBundle}</strong>
                      <p>{copy.watch.importBody}</p>
                      <input type="file" accept="application/json" onChange={handleImportBundle} />
                    </label>

                    {importedBundle ? (
                      <>
                        <IncidentPackCard incidentPack={importedBundle.incidentPack} labels={copy.cards} />
                        <DecisionReportCard report={importedBundle.decisionReport} labels={copy.cards} />
                        <ActionPlanCard plan={importedBundle.panicActionPlan} labels={copy.cards} />
                      </>
                    ) : null}
                  </>
                ) : (
                  <p>{copy.common.labMode}</p>
                )}
              </section>
            </div>
          ) : null}
        </section>

        <CanyonLandscape />
      </section>

      {tokenSelectorSide ? (
        <TokenSelectorModal
          title={tokenSelectorSide === "input" ? copy.trade.sell : copy.trade.buy}
          copy={copy}
          query={tokenSearch}
          onQueryChange={setTokenSearch}
          tokens={filteredTokenChoices}
          onClose={() => {
            setTokenSelectorSide(null);
            setTokenSearch("");
          }}
          onSelect={(mint) => selectToken(tokenSelectorSide, mint)}
        />
      ) : null}
    </div>
  );
}

function Rocky() {
  return (
    <svg className="flint-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="rockyBody" x1="6" y1="6" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff8b43" />
          <stop offset="1" stopColor="#d04e1a" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="32" height="32" rx="11" fill="url(#rockyBody)" />
      <path
        d="M8 15.5C10.6 10.8 13.7 12.8 16.2 11.7C18.2 10.8 18.8 7.8 21.2 8.7C23.4 9.5 23.8 12.7 26.2 12.1C28.6 11.4 30.2 10.5 32 14.8"
        stroke="#ffc08d"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M10.2 12.3L12.4 8.8L13.1 12.2"
        fill="#ffd9a8"
      />
      <path
        d="M27.6 10.8L30.4 7.2L30.6 11.4"
        fill="#ffd9a8"
      />
      <ellipse cx="14.2" cy="21" rx="4.1" ry="4.4" fill="#fff8ef" />
      <ellipse cx="25.8" cy="21" rx="4.1" ry="4.4" fill="#fff8ef" />
      <circle cx="14.6" cy="21.5" r="1.9" fill="#20110a" />
      <circle cx="25.4" cy="21.5" r="1.9" fill="#20110a" />
      <circle cx="15.2" cy="20.6" r="0.7" fill="#fff8ef" />
      <circle cx="26" cy="20.6" r="0.7" fill="#fff8ef" />
      <path
        d="M14 28.2C16 30.2 18.1 31.2 20 31.2C21.9 31.2 24 30.2 26 28.2"
        stroke="#fff4e8"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M11.5 17.3C12.6 16.3 13.7 15.9 15 15.9"
        stroke="#7f2d11"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M25 15.9C26.3 15.9 27.4 16.3 28.5 17.3"
        stroke="#7f2d11"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
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

function TokenSelectButton({
  token,
  copy,
  onClick,
}: {
  token: TokenOption | null;
  copy: ReturnType<typeof localeCopy>;
  onClick: () => void;
}) {
  return (
    <button type="button" className="token-select-button" onClick={onClick}>
      <span className="token-select-symbol">{token?.symbol ?? copy.trade.tokenModalTitle}</span>
      <span className="token-select-name">{token?.name ?? copy.trade.tokenModalTitle}</span>
      <span className="token-select-chevron">▾</span>
    </button>
  );
}

function QuoteCountdownPill({
  countdown,
  isRefreshing,
  label,
  refreshingLabel,
  readyLabel,
}: {
  countdown: number | null;
  isRefreshing: boolean;
  label: string;
  refreshingLabel: string;
  readyLabel: string;
}) {
  return (
    <div className="countdown-pill" aria-live="polite">
      <span>{label}</span>
      <strong>
        {isRefreshing
          ? refreshingLabel
          : countdown !== null
            ? formatCountdown(countdown)
            : readyLabel}
      </strong>
    </div>
  );
}

function TokenSelectorModal({
  title,
  copy,
  query,
  onQueryChange,
  tokens,
  onClose,
  onSelect,
}: {
  title: string;
  copy: ReturnType<typeof localeCopy>;
  query: string;
  onQueryChange: (next: string) => void;
  tokens: TokenOption[];
  onClose: () => void;
  onSelect: (mint: string) => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="token-modal-backdrop" onClick={onClose}>
      <div className="token-modal" onClick={(event) => event.stopPropagation()}>
        <div className="token-modal-head">
          <div>
            <span className="panel-kicker">{title}</span>
            <h2>{copy.trade.tokenModalTitle}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            {copy.trade.tokenModalClose}
          </button>
        </div>
        <label className="field">
          <span>{copy.trade.tokenModalSearch}</span>
          <input
            value={query}
            placeholder={copy.trade.tokenModalPlaceholder}
            onChange={(event) => onQueryChange(event.target.value)}
            autoFocus
          />
        </label>
        <div className="token-modal-list">
          {tokens.map((token) => (
            <button
              key={token.mint}
              type="button"
              className="token-row"
              onClick={() => onSelect(token.mint)}
            >
              <div>
                <strong>{token.symbol}</strong>
                <p>{token.name}</p>
              </div>
              <span>{shortenAddress(token.mint)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LeaderboardRow({
  rank,
  title,
  subtitle,
  status,
  detail,
  chips = [],
  linkLabel,
  linkHref,
}: {
  rank: number;
  title: string;
  subtitle: string;
  status: "safe" | "warn" | "blocked";
  detail: string;
  chips?: string[];
  linkLabel?: string;
  linkHref?: string;
}) {
  return (
    <article className="leaderboard-row">
      <div className="leaderboard-rank">{String(rank).padStart(2, "0")}</div>
      <div className="leaderboard-main">
        <div className="compact-route-head">
          <strong>{title}</strong>
          <span
            className={`status-tag ${
              status === "blocked" ? "alert" : status === "warn" ? "warning" : "safe"
            }`}
          >
            {status}
          </span>
        </div>
        <p>{subtitle}</p>
        {chips.length ? (
          <div className="chip-wrap tight-chip-wrap">
            {chips.map((chip) => (
              <span
                key={`${title}:${chip}`}
                className={`reason-chip ${status === "blocked" ? "blocking" : status === "warn" ? "warning" : "muted"}`}
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="leaderboard-side">
        <strong>{detail}</strong>
        {linkLabel && linkHref ? (
          <a className="inline-link" href={linkHref} target="_blank" rel="noreferrer">
            {linkLabel}
          </a>
        ) : null}
      </div>
    </article>
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

function TradeDecisionCard({
  comparison,
  assessment,
  outputQuote,
  outputMint,
  copy,
}: {
  comparison: QuoteComparison;
  assessment: QuoteComparison["baseAssessment"] | QuoteComparison["safeAssessment"];
  outputQuote: QuoteComparison["baseQuote"] | QuoteComparison["safeQuote"] | null;
  outputMint: string;
  copy: ReturnType<typeof localeCopy>;
}) {
  const variant =
    comparison.executionTarget === "safe"
      ? {
          title: copy.trade.safeRouteReadyTitle,
          body: copy.trade.safeRouteReadyBody,
          tone: "warning",
        }
      : comparison.executionTarget === "none"
        ? {
            title: copy.trade.executionBlockedTitle,
            body: copy.trade.executionBlockedBody,
            tone: "alert",
          }
        : {
            title: copy.trade.routeReadyTitle,
            body: copy.trade.routeReadyBody,
            tone: "safe",
          };

  return (
    <section className="execution-bar trade-decision-bar">
      <div>
        <span className="panel-kicker">{copy.trade.liveRouteBoard}</span>
        <strong>{variant.title}</strong>
        <p>{variant.body}</p>
        {assessment?.reasons?.length ? (
          <div className="chip-wrap dense-chip-wrap">
            {assessment.reasons.slice(0, 3).map((reason) => (
              <span
                key={reason.id}
                className={`reason-chip ${reason.blocking ? "blocking" : "warning"}`}
              >
                {reason.title}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="trade-decision-side">
        <span className={`status-tag ${variant.tone}`}>{assessment?.status ?? "unknown"}</span>
        <div className="mini-metrics">
          <div className="mini-metric">
            <span>{copy.trade.routeScore}</span>
            <strong>{assessment?.score ?? 0}</strong>
          </div>
          <div className="mini-metric">
            <span>{copy.trade.receive}</span>
            <strong>{outputQuote ? formatAtomic(outputQuote.outAmount, outputMint) : copy.common.none}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function RouteAssessmentCard({
  title,
  assessment,
  quote,
  outputMint,
  highlighted = false,
  copy,
}: {
  title: string;
  assessment: QuoteComparison["baseAssessment"];
  quote: QuoteComparison["baseQuote"];
  outputMint: string;
  highlighted?: boolean;
  copy: ReturnType<typeof localeCopy>;
}) {
  const venues = dedupeStrings(quote.routePlan.map((hop) => hop.swapInfo.label || "unknown"));
  return (
    <section className={`info-card route-card${highlighted ? " highlighted" : ""}`}>
      <span className="panel-kicker">{title}</span>
      <h2>{describeAssessment(assessment, copy)}</h2>
      <div className="report-grid">
        <SummaryPill label={copy.trade.routeScore} value={String(assessment.score)} />
        <SummaryPill label={copy.trade.priceImpact} value={`${Number(quote.priceImpactPct).toFixed(2)}%`} />
        <SummaryPill label={copy.trade.hops} value={String(quote.routePlan.length)} />
        <SummaryPill label={copy.trade.receive} value={formatAtomic(quote.outAmount, outputMint)} />
      </div>
      <div className="chip-wrap">
        {venues.map((venue) => (
          <span key={`${title}:${venue}`} className="chip-button active">
            {venue}
          </span>
        ))}
      </div>
      <div className="reason-list compact">
        {assessment.reasons.length ? (
          assessment.reasons.slice(0, 4).map((reason) => (
            <ReasonCard key={`${title}:${reason.id}`} reason={reason} />
          ))
        ) : (
          <div className="empty-state">
            <strong>{copy.trade.clearRouteTitle}</strong>
            <p>{copy.trade.clearRouteBody}</p>
          </div>
        )}
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
  copy,
  hasError,
}: {
  assessments: OrderAssessment[];
  ordersLoaded: boolean;
  dataMode: GuardDataMode;
  selectedOrderKeys: string[];
  onToggle: (orderKey: string) => void;
  copy: ReturnType<typeof localeCopy>;
  hasError: boolean;
}) {
  if (!assessments.length) {
    return (
      <div className="empty-state">
        <strong>
          {hasError
            ? copy.protect.degradedTitle
            : ordersLoaded
              ? copy.protect.noOrdersFound
              : copy.protect.noOrdersLoaded}
        </strong>
        <p>
          {hasError
            ? copy.protect.degradedBody
            : ordersLoaded
            ? copy.protect.noOrdersFoundBody
            : dataMode === "demo"
              ? copy.protect.demoHelper
              : hasError
                ? copy.common.notLoaded
                : copy.protect.noOrdersLoadedBody}
        </p>
      </div>
    );
  }

  const sortedAssessments = [...assessments].sort((left, right) => {
    if (left.candidate !== right.candidate) {
      return left.candidate ? -1 : 1;
    }
    return right.reasons.length - left.reasons.length;
  });

  return (
    <div className="order-list">
      {sortedAssessments.map((assessment) => (
        <label className={`order-card${assessment.candidate ? " candidate" : ""}`} key={assessment.order.orderKey}>
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
              {assessment.candidate ? copy.protect.cancelCandidate : copy.protect.monitorOnly}
            </span>
          </div>
          <div className="order-metrics">
            <span>
              {copy.protect.making} {formatAtomic(assessment.order.rawMakingAmount, assessment.order.inputMint)}
            </span>
            <span>
              {copy.protect.taking} {formatAtomic(assessment.order.rawTakingAmount, assessment.order.outputMint)}
            </span>
            <span>{copy.protect.slippage} {assessment.order.slippageBps ?? "n/a"} bps</span>
            <span>{copy.protect.venueLabel} {assessment.order.venue ?? "unknown"}</span>
          </div>
          <div className="order-reasons">
            {assessment.reasons.length ? (
              assessment.reasons.map((reason) => <ReasonChip key={reason.id} reason={reason} />)
            ) : (
              <span className="reason-chip muted">{copy.protect.noPanicReason}</span>
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
  emptyTitle,
  emptyBody,
}: {
  title: string;
  description: string;
  entries: ActivityLogEntry[];
  emptyTitle: string;
  emptyBody: string;
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
          <strong>{emptyTitle}</strong>
          <p>{emptyBody}</p>
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
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange: (next: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
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
  copy,
}: {
  preset: GuardPolicyPreset;
  onChange: (preset: GuardPolicyPreset) => void;
  safeMode: boolean;
  onToggleSafeMode: (next: boolean) => void;
  panicMode: boolean;
  onTogglePanicMode: (next: boolean) => void;
  copy: ReturnType<typeof localeCopy>;
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
        label={copy.protect.safeModeLabel}
        description={copy.protect.safeModeBody}
        checked={safeMode}
        onChange={onToggleSafeMode}
      />
      <ToggleLine
        label={copy.protect.panicModeLabel}
        description={copy.protect.panicModeBody}
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
  labels,
}: {
  dataMode: GuardDataMode;
  onChange: (next: GuardDataMode) => void;
  activeScenarioId: DemoScenarioId;
  onScenarioChange: (next: DemoScenarioId) => void;
  labels: {
    seededDemo: string;
    liveApis: string;
  };
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
            {mode === "demo" ? labels.seededDemo : labels.liveApis}
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

function describeAssessment(
  assessment: QuoteComparison["baseAssessment"],
  copy: ReturnType<typeof localeCopy>
) {
  switch (assessment.status) {
    case "blocked":
      return copy.trade.executionBlockedTitle;
    case "warn":
      return copy.trade.reviewRouteTitle;
    case "safe":
      return copy.trade.routeReadyTitle;
  }
}

function describeNetworkError(error: unknown, surface: "quote" | "feed" | "market" | "orders") {
  if (error instanceof Error) {
    if (error.message === "network_unavailable" || error.message === "Failed to fetch") {
      switch (surface) {
        case "quote":
          return "Live quote data is temporarily unavailable. Flint kept your current trade form intact.";
        case "feed":
          return "Relay data is temporarily unavailable. Flint kept the local watch surface active.";
        case "market":
          return "Live market data is temporarily unavailable. Flint kept the last market board.";
        case "orders":
          return "Live order data is temporarily unavailable. Try refreshing again in a moment.";
      }
    }
    if (error.message === "request_timeout") {
      return "The live request timed out before the provider responded.";
    }
    return error.message;
  }
  return `${surface}_request_failed`;
}

function formatCountdown(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(
    safeSeconds % 60
  ).padStart(2, "0")}`;
}

function roundCountdownSeconds(remainingMs: number) {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (seconds <= 10) return seconds;
  return Math.ceil(seconds / 5) * 5;
}

function formatConfidence(
  confidence: "full-route" | "pair-only",
  copy: ReturnType<typeof localeCopy>
) {
  return confidence === "full-route" ? copy.watch.fullRoute : copy.watch.pairOnly;
}

function chooseQuoteDirection(pair: {
  baseToken: { address: string; symbol: string };
  quoteToken: { address: string; symbol: string };
}) {
  const baseKnown = tokenByMint(pair.baseToken.address);
  const quoteKnown = tokenByMint(pair.quoteToken.address);
  if (baseKnown) {
    return {
      inputMint: pair.baseToken.address,
      inputSymbol: pair.baseToken.symbol,
      outputMint: pair.quoteToken.address,
      outputSymbol: pair.quoteToken.symbol,
    };
  }
  if (quoteKnown) {
    return {
      inputMint: pair.quoteToken.address,
      inputSymbol: pair.quoteToken.symbol,
      outputMint: pair.baseToken.address,
      outputSymbol: pair.baseToken.symbol,
    };
  }
  return null;
}

function sampleQuoteAmount(token: TokenOption, usdPrice: number | null) {
  if (!usdPrice || usdPrice <= 0) {
    if (token.symbol === "USDC") return "250";
    if (token.symbol === "SOL" || token.symbol === "mSOL" || token.symbol === "jitoSOL") {
      return "1";
    }
    if (token.symbol === "JUP") return "500";
    if (token.symbol === "BONK") return "500000";
    return "100";
  }
  const targetUsd = 250;
  return String(Number((targetUsd / usdPrice).toFixed(token.decimals > 6 ? 4 : 2)));
}

function syntheticToken(mint: string, symbol: string): TokenOption {
  return {
    mint,
    symbol,
    name: symbol,
    decimals: 6,
  };
}

function pairToPoolSnapshot(pair: {
  pairAddress: string;
  dexId: string | null;
  liquidityUsd: number | null;
  pairCreatedAt: number | null;
  priceChangeH1: number | null;
  priceChangeM5: number | null;
  buysM5: number | null;
  sellsM5: number | null;
  url: string | null;
}): PoolSnapshot {
  return {
    ammKey: pair.pairAddress,
    dexId: pair.dexId,
    liquidityUsd: pair.liquidityUsd,
    pairCreatedAt: pair.pairCreatedAt,
    priceChangeH1: pair.priceChangeH1,
    priceChangeM5: pair.priceChangeM5,
    buysM5: pair.buysM5,
    sellsM5: pair.sellsM5,
    url: pair.url,
  };
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeWatchPair(value: string) {
  if (!value.includes("::")) return value.trim();
  const [left, right] = value.split("::");
  return canonicalPairKey(left, right);
}

function CanyonLandscape() {
  return (
    <div className="stage-landscape" aria-hidden="true">
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Canyon walls: transparent at top, solid at bottom */}
          <linearGradient id="wallFade" x1="0" y1="0" x2="0" y2="900" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#3c1608" stopOpacity="0"/>
            <stop offset="28%"  stopColor="#3c1608" stopOpacity="0.55"/>
            <stop offset="60%"  stopColor="#4e2010" stopOpacity="0.93"/>
            <stop offset="100%" stopColor="#5e2814" stopOpacity="1"/>
          </linearGradient>
          {/* Warm floor glow rising from bottom */}
          <radialGradient id="floorGlow" cx="50%" cy="100%" r="55%">
            <stop offset="0%"   stopColor="#b84008" stopOpacity="0.50"/>
            <stop offset="100%" stopColor="#b84008" stopOpacity="0"/>
          </radialGradient>
          {/* Rocky character halo */}
          <radialGradient id="rockHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#f09030" stopOpacity="0.40"/>
            <stop offset="100%" stopColor="#f09030" stopOpacity="0"/>
          </radialGradient>
        </defs>

        {/* Warm ambient from floor — sets the mood */}
        <rect x="0" y="0" width="1440" height="900" fill="url(#floorGlow)"/>

        {/* ── LEFT CANYON WALL ──
            Full height, transparent at very top, solid below */}
        <path
          d="M0 900 L0 0 L300 0
             Q278 55 308 110
             Q285 165 320 215
             Q298 270 332 320
             Q308 375 342 425
             Q316 480 350 528
             Q324 580 362 628
             Q336 680 378 726
             Q354 778 400 820
             L400 900 Z"
          fill="url(#wallFade)"
        />
        {/* Left wall inner shadow for depth */}
        <path
          d="M0 900 L0 250
             Q60 268 50 330
             Q38 390 72 442
             Q90 488 65 540
             Q42 590 80 636
             Q106 672 88 722
             Q68 768 118 808
             L120 900 Z"
          fill="#200c04" opacity="0.55"
        />

        {/* ── RIGHT CANYON WALL ── */}
        <path
          d="M1440 900 L1440 0 L1140 0
             Q1162 55 1132 110
             Q1155 165 1120 215
             Q1142 270 1108 320
             Q1132 375 1098 425
             Q1124 480 1090 528
             Q1116 580 1078 628
             Q1104 680 1062 726
             Q1086 778 1040 820
             L1040 900 Z"
          fill="url(#wallFade)"
        />
        {/* Right wall inner shadow */}
        <path
          d="M1440 900 L1440 250
             Q1380 268 1390 330
             Q1402 390 1368 442
             Q1350 488 1375 540
             Q1398 590 1360 636
             Q1334 672 1352 722
             Q1372 768 1322 808
             L1320 900 Z"
          fill="#200c04" opacity="0.55"
        />

        {/* ── DISTANT BACK BUTTES (between walls, deep) ── */}
        <path
          d="M310 900 L310 380
             Q380 350 460 368 Q520 382 580 348
             Q640 314 710 336 Q750 350 780 320
             Q820 290 870 312 Q920 334 980 308
             Q1040 282 1100 302 Q1130 312 1130 380
             L1130 900 Z"
          fill="#3a1608" opacity="0.88"
        />

        {/* ── MID ROCK LAYER ── */}
        <path
          d="M260 900 L260 510
             Q330 492 410 506 Q490 520 556 496
             Q600 480 638 497 L638 470
             Q654 458 672 464 Q690 470 706 460
             L706 488 Q770 474 850 492
             Q930 508 996 488 Q1042 472 1080 488
             L1080 466 Q1098 454 1118 458 L1118 484
             Q1160 472 1180 900 Z"
          fill="#582212" opacity="0.95"
        />

        {/* ── NEAR FOREGROUND ROCKS ── */}
        <path
          d="M0 900 L0 634
             Q90 614 190 626 Q300 638 386 614
             Q450 596 510 614 L510 594
             Q528 580 548 586 Q568 592 586 582
             L586 610 Q668 596 760 614
             Q852 632 930 608 Q984 590 1040 610
             L1040 588 Q1060 574 1082 578 Q1104 582 1124 572
             L1124 600 Q1210 588 1320 606 Q1400 618 1440 610
             L1440 900 Z"
          fill="#6e2a10"
        />

        {/* Rocky glow */}
        <ellipse cx="720" cy="780" rx="110" ry="65" fill="url(#rockHalo)"/>

        {/* ── ROCKY (rounded-square, matches nav icon) ── */}
        <g transform="translate(720, 748)">
          <ellipse cx="0" cy="50" rx="40" ry="9" fill="#1a0804" opacity="0.45"/>
          <rect x="-36" y="-36" width="72" height="74" rx="18" fill="#f07030"/>
          <path d="M-32 -16 Q-23 -28 -14 -22 Q-5 -30 4 -25 Q13 -30 22 -22 Q31 -28 32 -16"
            stroke="#ff9050" strokeWidth="2.4" fill="none" strokeLinecap="round"/>
          <circle cx="-13" cy="6"  r="6"   fill="white"/>
          <circle cx=" 13" cy="6"  r="6"   fill="white"/>
          <circle cx="-13" cy="7"  r="3"   fill="#1a0804"/>
          <circle cx=" 13" cy="7"  r="3"   fill="#1a0804"/>
          <circle cx="-11" cy="4.5" r="1.2" fill="white" opacity="0.9"/>
          <circle cx=" 15" cy="4.5" r="1.2" fill="white" opacity="0.9"/>
          <path d="M-13 22 Q0 32 13 22" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
          <path d="M-10 -42 L-7 -56 L-9 -48 L-15 -52 Z" fill="#ffd060"/>
          <path d=" 10 -40 L 13 -54 L 11 -46 L  7 -50 Z" fill="#ffd060"/>
          <circle cx="24" cy="-50" r="4"   fill="#ffbf40" opacity="0.85"/>
          <circle cx="-22" cy="-48" r="3.2" fill="#ffbf40" opacity="0.75"/>
          <circle cx="2"   cy="-60" r="2.6" fill="#fff0a0" opacity="0.90"/>
        </g>

        {/* Pebble — left near */}
        <g transform="translate(536, 762)">
          <ellipse cx="0" cy="28" rx="26" ry="6" fill="#1a0804" opacity="0.35"/>
          <rect x="-22" y="-22" width="44" height="42" rx="13" fill="#c05828"/>
          <path d="M-18 -10 Q-10 -18 0 -13 Q10 -18 18 -10" stroke="#d97040" strokeWidth="1.7" fill="none" strokeLinecap="round"/>
          <circle cx="-8"  cy="-1" r="4.5" fill="white"/>
          <circle cx=" 8"  cy="-1" r="4.5" fill="white"/>
          <circle cx="-8"  cy="-0.4" r="2.2" fill="#1a0804"/>
          <circle cx=" 8"  cy="-0.4" r="2.2" fill="#1a0804"/>
          <path d="M-8 12 Q0 18 8 12" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/>
        </g>

        {/* Pebble — right near */}
        <g transform="translate(906, 766)">
          <ellipse cx="0" cy="26" rx="24" ry="5" fill="#1a0804" opacity="0.35"/>
          <rect x="-20" y="-20" width="40" height="38" rx="11" fill="#b05020"/>
          <path d="M-16 -9 Q-8 -17 0 -12 Q8 -17 16 -9" stroke="#cc6838" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
          <circle cx="-7"  cy="-1" r="4"   fill="white"/>
          <circle cx=" 7"  cy="-1" r="4"   fill="white"/>
          <circle cx="-7"  cy="-0.4" r="2"  fill="#1a0804"/>
          <circle cx=" 7"  cy="-0.4" r="2"  fill="#1a0804"/>
          <path d="M-7 10 Q0 16 7 10" stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
        </g>

        {/* Tiny pebble — far left */}
        <g transform="translate(388, 782)">
          <rect x="-14" y="-13" width="28" height="26" rx="8" fill="#a04820"/>
          <circle cx="-5"  cy="-1" r="3"   fill="white"/>
          <circle cx=" 5"  cy="-1" r="3"   fill="white"/>
          <circle cx="-5"  cy="-0.5" r="1.5" fill="#1a0804"/>
          <circle cx=" 5"  cy="-0.5" r="1.5" fill="#1a0804"/>
          <path d="M-4 8 Q0 12 4 8" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </g>

        {/* Tiny pebble — far right */}
        <g transform="translate(1056, 776)">
          <rect x="-13" y="-12" width="26" height="24" rx="7" fill="#a84e24"/>
          <circle cx="-4.5" cy="-1" r="2.8" fill="white"/>
          <circle cx=" 4.5" cy="-1" r="2.8" fill="white"/>
          <circle cx="-4.5" cy="-0.5" r="1.4" fill="#1a0804"/>
          <circle cx=" 4.5" cy="-0.5" r="1.4" fill="#1a0804"/>
          <path d="M-4 7 Q0 11 4 7" stroke="white" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
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
