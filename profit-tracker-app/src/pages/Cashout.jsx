import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Coins,
  Copy,
  RefreshCw,
  Plus,
  Search,
  AlertTriangle,
  KeyRound,
  Layers,
  X,
  Package,
  ChevronDown,
  Star,
  Table,
  LayoutGrid,
  ExternalLink,
  DollarSign,
  ShoppingCart,
  CreditCard,
  Truck,
  BellRing,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useCashoutProviders,
  useCashoutConnections,
  useCashoutDeals,
  useCashoutMutations,
  useCashoutCommitments,
  usePlatforms,
  usePaymentMethods,
  useInvalidate,
  apiFetch,
} from '../hooks/useApi';
import { formatMoney } from '../utils/money';
import { accountLabel, commitmentAccountSummary } from '../utils/storeAccounts';
import { batchCost, effectiveCashbackRate } from '../../../shared/finance.mjs';
import { displayLabel, statusVisual } from '../data/statusWorkflow';
import { useMatchMedia } from '../hooks/useMatchMedia';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { offerPendingCommit, offerTrackingSend } from '../utils/pendingCashoutCommit';
import {
  bestCardForDeal,
  formatDealRoi,
  dealRoi,
  dealConditionLabels,
  dealLimitLabel,
  dealBoughtCount,
  dealBoughtLabel,
  dealStoreNames,
  estimateDealProfit,
  formatDealExpiry,
  formatDealProfit,
  formatLastSynced,
  groupDealsByProduct,
  groupStoreLinks,
  isDealExpired,
  matchesRetailCategory,
  parseDealNotes,
  storeLogoUrl,
} from '../utils/cashoutDeals';
import LoadError from '../components/UI/LoadError';
import NewDeals from '../components/Cashout/NewDeals';

// API keys are managed only in Data Setup.
const DATA_SETUP_STATE = { tab: 'datasetup', view: 'Cashouts' };
const PAYMENT_METHODS_STATE = { tab: 'datasetup', view: 'Payment Methods' };

// Below this the table no longer fits beside the sidebar -- cards take over
// regardless of the view toggle.
const DEAL_CARDS_QUERY = '(max-width: 1279px)';
// How many deal cards each "Show more" adds (cards view only; the table lists everything).
const DEAL_CARDS_PER_PAGE = 24;

const VIEW_MODE_KEY = 'cashoutViewMode';

// About what fits on one line of a table row. Longer notes get a More button.
const NOTE_PREVIEW_LENGTH = 40;

const SELECT_CLASS = 'px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)]';

export default function Cashout() {
  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all'); // 'all' | 'above_retail' | 'close_to_retail'
  const [selectedStore, setSelectedStore] = useState('all');
  const [showExpired, setShowExpired] = useState(false);
  const [minRoi, setMinRoi] = useState('any'); // 'any' or a percent: '0', '2', '5', '10', '15'
  // Newest deals first every time the page opens.
  const [sortBy, setSortBy] = useState('updated_desc'); // 'profit_desc' | 'payout_desc' | 'ending_soon' | 'updated_desc'
  const [viewMode, setViewMode] = useState(() => (localStorage.getItem(VIEW_MODE_KEY) === 'card' ? 'card' : 'table'));
  const setView = (mode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };
  const screenForcesCards = useMatchMedia(DEAL_CARDS_QUERY);
  const showCards = screenForcesCards || viewMode === 'card';

  // Cooldown timer state for manual sync
  const [syncCooldownSeconds, setSyncCooldownSeconds] = useState(0);

  // API Hooks
  const {
    data: providers = [],
    isLoading: providersLoading,
    error: providersError,
    refetch: refetchProviders,
  } = useCashoutProviders();

  const {
    data: connections = [],
    isLoading: connectionsLoading,
    error: connectionsError,
    refetch: refetchConnections,
  } = useCashoutConnections();

  const {
    data: dealsData,
    isLoading: dealsLoading,
    error: dealsError,
    refetch: refetchDeals,
    isFetching: dealsFetching,
  } = useCashoutDeals();

  const { syncConnection } = useCashoutMutations();
  const { data: paymentMethods = [] } = usePaymentMethods();

  // Cooldown ticker
  useEffect(() => {
    if (syncCooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setSyncCooldownSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [syncCooldownSeconds]);

  // Aggregate deals across connections
  const allDeals = useMemo(() => {
    if (!dealsData?.results) return [];
    // Cashouts without commit support (Points4Days) get a link to the deal on
    // their website instead of Log Purchase.
    const providerNames = new Map(providers.map((p) => [p.id, p.name]));
    const noCommits = new Set(providers.filter((p) => p.supportsCommits === false).map((p) => p.id));
    const aggregated = [];
    for (const res of dealsData.results) {
      if (Array.isArray(res.deals)) {
        for (const deal of res.deals) {
          aggregated.push({
            ...deal,
            estimatedProfit: estimateDealProfit(deal),
            connectionId: res.connection?.id,
            connectionName: res.connection?.displayName || providerNames.get(res.connection?.provider) || res.connection?.provider,
            connectionProvider: res.connection?.provider,
            connectionSupportsCommits: !noCommits.has(res.connection?.provider),
            connectionPlatformId: res.connection?.platformId || null,
            connectionStatus: res.connection?.status,
            connectionError: res.connection?.lastError,
          });
        }
      }
    }
    return aggregated;
  }, [dealsData, providers]);

  const storeOptions = useMemo(
    () => [...new Set(allDeals.flatMap(dealStoreNames))].sort((a, b) => a.localeCompare(b)),
    [allDeals],
  );
  const expiredCount = useMemo(() => allDeals.filter((deal) => isDealExpired(deal)).length, [allDeals]);
  // Live products, counting one listed by two cashouts once, like the table does.
  const liveProductCount = useMemo(
    () => groupDealsByProduct(allDeals.filter((deal) => !isDealExpired(deal))).length,
    [allDeals],
  );

  // ?tab=new-deals (from a deal notification) or ?tab=commitments opens that tab.
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const urlTab = urlParams.get('tab');
  const highlightAlert = urlParams.get('alert');
  const [tab, setTab] = useState(() => (['new-deals', 'commitments'].includes(urlTab) ? urlTab : 'live'));
  useEffect(() => {
    if (['new-deals', 'commitments'].includes(urlTab)) setTab(urlTab);
  }, [urlTab, location.key]);
  const showCommitments = tab === 'commitments';
  const showNewDeals = tab === 'new-deals';
  const showLive = tab === 'live';
  const setShowCommitments = (on) => setTab(on ? 'commitments' : 'live');
  const { data: commitments = [] } = useCashoutCommitments();
  const activeCommitmentCount = useMemo(() => commitments.filter((c) => c.status === 'active').length, [commitments]);

  // Filter & Sort
  const filteredDeals = useMemo(() => {
    const matching = allDeals.filter((deal) => {
      // Expired deals can't be acted on, so they stay out of the way until asked for
      if (!showExpired && isDealExpired(deal)) return false;

      // Provider filter
      if (selectedProvider !== 'all' && deal.connectionProvider !== selectedProvider) {
        return false;
      }

      // Category filter
      if (!matchesRetailCategory(deal, selectedCategory)) return false;

      // Store filter
      if (selectedStore !== 'all' && !dealStoreNames(deal).includes(selectedStore)) return false;

      // Search term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const titleMatch = deal.name?.toLowerCase().includes(query);
        const itemMatch = deal.items?.some((i) => i.name?.toLowerCase().includes(query) || i.upcs?.some((u) => u.includes(query)));
        if (!titleMatch && !itemMatch) return false;
      }

      return true;
    });
    // One row per product: the same product from several cashouts shares a row.
    // ROI counts the best saved card's rewards, like the Best Card column.
    const roiOf = new Map();
    const roi = (deal) => {
      if (!roiOf.has(deal)) roiOf.set(deal, dealRoi(deal, paymentMethods));
      return roiOf.get(deal);
    };
    const grouped = groupDealsByProduct(matching);
    // A deal with no retail price has no ROI, so a minimum leaves it out.
    const kept = minRoi === 'any' ? grouped : grouped.filter((deal) => roi(deal) !== null && roi(deal) >= Number(minRoi));
    return kept.sort((a, b) => {
      // Expired deals can't be bought, so they sit below every live one.
      const expiredOrder = isDealExpired(a) - isDealExpired(b);
      if (expiredOrder !== 0) return expiredOrder;

      if (sortBy === 'payout_desc') {
        return (b.payout || 0) - (a.payout || 0);
      }
      if (sortBy === 'profit_desc') {
        // Deals with no estimate go last rather than counting as $0.
        return (b.estimatedProfit?.amount ?? -Infinity) - (a.estimatedProfit?.amount ?? -Infinity);
      }
      if (sortBy === 'roi_desc') {
        // Deals with no ROI go last.
        return (roi(b) ?? -Infinity) - (roi(a) ?? -Infinity);
      }
      if (sortBy === 'ending_soon') {
        // Deals with no expiration go last.
        const expiresAt = (deal) => (deal.expiresAt ? new Date(deal.expiresAt).getTime() : Infinity);
        return expiresAt(a) === expiresAt(b) ? 0 : expiresAt(a) - expiresAt(b);
      }
      if (sortBy === 'updated_desc') {
        // EB says when it posted a deal; LA and P4D don't, so it's when
        // Profit Tracker first saw it.
        const added = (deal) => new Date(deal.createdAt || deal.firstSeenAt || 0).getTime();
        return added(b) - added(a);
      }
      return 0;
    });
  }, [allDeals, selectedProvider, selectedCategory, selectedStore, showExpired, searchTerm, sortBy, minRoi, paymentMethods]);

  // Deal cards come a page at a time: a hundred full cards made the phone
  // page dozens of screens long. A new search, filter or sort starts again
  // from the first page (the count only applies to the list it was set for).
  const dealsListKey = [selectedProvider, selectedCategory, selectedStore, showExpired, searchTerm, sortBy, minRoi].join('|');
  const [dealPaging, setDealPaging] = useState({ key: '', count: DEAL_CARDS_PER_PAGE });
  const dealCardsShown = dealPaging.key === dealsListKey ? dealPaging.count : DEAL_CARDS_PER_PAGE;
  const dealCards = filteredDeals.slice(0, dealCardsShown);
  const dealCardsLeft = filteredDeals.length - dealCards.length;

  if (providersError || connectionsError || dealsError) {
    return (
      <LoadError
        title="Cashout Deals"
        what="cashout data"
        onRetry={() => {
          refetchProviders();
          refetchConnections();
          refetchDeals();
        }}
      />
    );
  }

  // Access check: only show to users in beta / with access to at least 1 provider
  if (!providersLoading && providers.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] flex items-center justify-center text-[var(--dp-accent)]">
          <Coins size={32} />
        </div>
        <h1 className="text-2xl font-bold text-[var(--dp-text-primary)]">Cashout is not available</h1>
        <p className="mt-2 text-sm text-[var(--dp-text-secondary)] max-w-md mx-auto">
          The Cashout integration is currently in private preview. When it opens to your account, you will be able to connect your cashout services here.
        </p>
      </div>
    );
  }

  // Handle Manual "Sync Now"
  const handleSyncNow = async () => {
    if (connections.length === 0) {
      toast.error('Connect a cashout service first before syncing.');
      return;
    }

    if (syncCooldownSeconds > 0) {
      toast.info(`Sync cooldown active. Please wait ${syncCooldownSeconds}s.`);
      return;
    }

    const toastId = toast.loading('Syncing cashout deals…');
    try {
      let anySynced = false;
      for (const conn of connections) {
        try {
          await syncConnection.mutateAsync(conn.id);
          anySynced = true;
        } catch (err) {
          if (err.cooldown && err.remainingSeconds) {
            setSyncCooldownSeconds(err.remainingSeconds);
          }
          throw err;
        }
      }
      if (anySynced) {
        setSyncCooldownSeconds(60);
        await refetchDeals();
        toast.success('Cashout deals synced successfully!', { id: toastId });
      }
    } catch (err) {
      if (err.cooldown) {
        toast.info(err.message, { id: toastId });
        return;
      }
      setSyncCooldownSeconds(60);
      toast.error(err.message || 'Failed to sync cashout connections', { id: toastId });
      refetchDeals();
    }
  };

  const lastSynced = formatLastSynced(dealsData?.results);
  const troubledResult = dealsData?.results?.find((r) => r.isStale || r.connection?.status === 'attention_needed');
  const troubleMessage = troubledResult && (
    troubledResult.warning
    || troubledResult.error
    || troubledResult.connection?.lastError
    || 'A cashout connection needs attention.'
  );

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-[var(--dp-text-primary)]">Cashout Deals</h1>
            <span className="px-2 py-0.5 text-[12px] font-semibold rounded-full bg-[var(--dp-accent-bg)] text-[var(--dp-accent)] border border-[color:var(--dp-accent)]/20">
              Beta
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--dp-text-secondary)]">
            Live payouts from your connected cashout services.
          </p>
        </div>

        {/* Wraps on phones: "Last synced …" plus Manage Cashouts don't fit one row at 375px. */}
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="flex flex-col items-start sm:items-center gap-1">
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncConnection.isPending || syncCooldownSeconds > 0}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors disabled:opacity-50"
              title={syncCooldownSeconds > 0 ? `Cooldown: ${syncCooldownSeconds}s` : 'Sync live deals'}
            >
              <RefreshCw size={14} className={syncConnection.isPending || dealsFetching ? 'animate-spin' : ''} />
              <span>{syncCooldownSeconds > 0 ? `Sync (${syncCooldownSeconds}s)` : 'Sync now'}</span>
            </button>
            {lastSynced && (
              <span className="text-[12px] text-[var(--dp-text-label)] whitespace-nowrap">
                Last synced {lastSynced}
              </span>
            )}
          </div>

          <Link
            to="/settings"
            state={DATA_SETUP_STATE}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors"
          >
            <KeyRound size={14} />
            <span>Manage Cashouts</span>
            {connections.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-[var(--dp-hover-bg)] text-[12px]">
                {connections.length}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Connection Stale / Attention Needed Warning Banner */}
      {troubledResult && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
            <span>{troubleMessage}</span>
          </div>
          <Link
            to="/settings"
            state={DATA_SETUP_STATE}
            className="font-semibold underline hover:text-white"
          >
            Review in Data Setup
          </Link>
        </div>
      )}

      {/* Tabs: Live Deals / Commitments */}
      <div role="tablist" className="flex items-center gap-0.5 sm:gap-1 border-b border-[color:var(--dp-border)]">
        <button
          type="button"
          role="tab"
          aria-selected={showLive}
          onClick={() => setShowCommitments(false)}
          className={`flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2.5 -mb-px whitespace-nowrap text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
            showLive
              ? 'bg-[var(--dp-card-bg)] border-[color:var(--dp-border)] text-[var(--dp-text-primary)]'
              : 'bg-transparent border-transparent text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'
          }`}
        >
          <Layers size={15} className={`hidden sm:block ${showLive ? 'text-[var(--dp-accent)]' : ''}`} />
          <span>Live Deals</span>
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-[var(--dp-hover-bg)]">
            {liveProductCount}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showCommitments}
          onClick={() => setShowCommitments(true)}
          className={`flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2.5 -mb-px whitespace-nowrap text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
            showCommitments
              ? 'bg-[var(--dp-card-bg)] border-[color:var(--dp-border)] text-[var(--dp-text-primary)]'
              : 'bg-transparent border-transparent text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'
          }`}
        >
          <span>Commitments</span>
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-[var(--dp-hover-bg)]">{activeCommitmentCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showNewDeals}
          onClick={() => setTab('new-deals')}
          className={`flex shrink-0 items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2.5 -mb-px whitespace-nowrap text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
            showNewDeals
              ? 'bg-[var(--dp-card-bg)] border-[color:var(--dp-border)] text-[var(--dp-text-primary)]'
              : 'bg-transparent border-transparent text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'
          }`}
        >
          <BellRing size={15} className={`hidden sm:block ${showNewDeals ? 'text-[var(--dp-accent)]' : ''}`} />
          <span>New deals</span>
        </button>
        {showLive && expiredCount > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs font-normal text-[var(--dp-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={showExpired}
              onChange={(e) => setShowExpired(e.target.checked)}
            />
            <span>Show expired ({expiredCount})</span>
          </label>
        )}
      </div>

      {showCommitments && <CommitmentsPanel commitments={commitments} allDeals={allDeals} />}

      {showNewDeals && <NewDeals highlightId={highlightAlert} />}

      {/* Empty State when no connections added yet */}
      {showLive && (connectionsLoading ? (
        <div className="p-8 text-center text-xs text-[var(--dp-text-secondary)]">Loading cashout deals…</div>
      ) : connections.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-10 text-center max-w-md mx-auto my-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--dp-accent-bg)] flex items-center justify-center text-[var(--dp-accent)]">
            <Coins size={28} />
          </div>
          <h2 className="text-lg font-bold text-[var(--dp-text-primary)]">See Cashout Deals Now</h2>
          <p className="mt-1.5 text-xs text-[var(--dp-text-secondary)]">
            Connect your API keys to start viewing live cashout deals.
          </p>
          {providers.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-left">
              {providers.map((provider) => (
                <li
                  key={provider.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-xs"
                >
                  <span className="font-medium text-[var(--dp-text-primary)]">{provider.name}</span>
                  <span className="text-[12px] text-[var(--dp-text-label)]">Not connected</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/settings"
            state={DATA_SETUP_STATE}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            <span>Connect your API keys</span>
          </Link>
        </div>
      ) : (
        <>
          {/* Search, Filter & Controls */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dp-text-label)]" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search deals"
                  placeholder="Search deals, UPCs, items…"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none focus:border-[var(--dp-accent)]"
                />
                {searchTerm && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {!screenForcesCards && (
                <div role="group" aria-label="View" className="flex items-center gap-0.5 p-0.5 ml-1 rounded-lg bg-[var(--dp-hover-bg)] border-l border-[color:var(--dp-border)] flex-shrink-0">
                  <button
                    type="button"
                    aria-label="Table view"
                    aria-pressed={viewMode === 'table'}
                    onClick={() => setView('table')}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-[var(--dp-card-bg)] text-[var(--dp-accent)] shadow-sm' : 'text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]'}`}
                  >
                    <Table size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="Card view"
                    aria-pressed={viewMode === 'card'}
                    onClick={() => setView('card')}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'card' ? 'bg-[var(--dp-card-bg)] text-[var(--dp-accent)] shadow-sm' : 'text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]'}`}
                  >
                    <LayoutGrid size={15} />
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Provider Filter */}
              <select
                aria-label="Filter by cashout"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="all">All Cashouts</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.provider}>
                    {c.displayName || providers.find((p) => p.id === c.provider)?.name || c.provider}
                  </option>
                ))}
              </select>

              {/* Category Filter */}
              <select
                aria-label="Filter by category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="all">All Categories</option>
                <option value="above_retail">Above Retail</option>
                <option value="close_to_retail">Close to Retail</option>
              </select>

              {/* Store Filter */}
              <select
                aria-label="Filter by store"
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="all">All Stores</option>
                {storeOptions.map((store) => (
                  <option key={store} value={store}>{store}</option>
                ))}
              </select>

              {/* Minimum ROI */}
              <select
                aria-label="Filter by minimum ROI"
                value={minRoi}
                onChange={(e) => setMinRoi(e.target.value)}
                className={SELECT_CLASS}
                title="ROI is profit as a percent of retail, with your best card's rewards."
              >
                <option value="any">Any ROI</option>
                <option value="0">ROI 0%+</option>
                <option value="2">ROI 2%+</option>
                <option value="5">ROI 5%+</option>
                <option value="10">ROI 10%+</option>
                <option value="15">ROI 15%+</option>
              </select>

              {/* Sort Dropdown */}
              <select
                aria-label="Sort deals"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="profit_desc">Highest Profit</option>
                <option value="roi_desc">Highest ROI</option>
                <option value="payout_desc">Highest Payout</option>
                <option value="ending_soon">Ending Soon</option>
                <option value="updated_desc">Recently Added</option>
              </select>
            </div>
          </div>

          {/* Deals Table / Cards */}
          {dealsLoading ? (
            <div className="p-8 text-center rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs text-[var(--dp-text-secondary)]">
              Loading cashout deals…
            </div>
          ) : filteredDeals.length === 0 ? (
            <div className="p-8 text-center rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs text-[var(--dp-text-secondary)]">
              {allDeals.length === 0 ? 'No live deals right now.' : 'No cashout deals matched your search and filters.'}
            </div>
          ) : showCards ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                {dealCards.map((deal) => (
                  <DealCard key={`${deal.connectionId}-${deal.id}`} deal={deal} paymentMethods={paymentMethods} commitments={commitments} />
                ))}
              </div>
              {dealCardsLeft > 0 && (
                <div className="mt-4 flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDealPaging({ key: dealsListKey, count: dealCardsShown + DEAL_CARDS_PER_PAGE })}
                    className="h-11 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-5 text-sm font-medium text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors"
                  >
                    Show {Math.min(DEAL_CARDS_PER_PAGE, dealCardsLeft)} more
                  </button>
                  <p className="text-xs text-[var(--dp-text-secondary)]">Showing {dealCards.length} of {filteredDeals.length} deals</p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[color:var(--dp-border)] text-[var(--dp-text-label)] uppercase font-semibold text-[12px] tracking-wider align-top">
                      <th className="py-3 px-4">Deal / Item</th>
                      <th className="py-3 px-3">Cashout</th>
                      <th className="py-3 px-3 text-right">Payout</th>
                      <th className="py-3 px-3 text-right">Retail</th>
                      <th
                        className="py-3 px-3 text-right whitespace-nowrap"
                        title="Payout minus retail, and the ROI: that profit as a percent of retail. Doesn't include sales tax, cashback or coupons."
                      >
                        Est. Profit
                        <span className="block font-normal normal-case tracking-normal">before tax</span>
                      </th>
                      <th
                        className="py-3 px-3 whitespace-nowrap text-center"
                        title="Your saved card that earns the most at one of this deal's stores, the profit with its cashback on retail, and that profit's ROI (percent of retail)."
                      >
                        Best Card
                        <span className="block font-normal normal-case tracking-normal">profit with rewards</span>
                      </th>
                      <th className="py-3 px-3">Expires</th>
                      <th className="py-3 px-3">Buy At</th>
                      <th className="py-3 pl-3 pr-6 w-px"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--dp-border)]">
                    {filteredDeals.map((deal) => {
                      const expired = isDealExpired(deal);
                      return (
                        <tr
                          key={`${deal.connectionId}-${deal.id}`}
                          className={`hover:bg-[var(--dp-hover-bg)] transition-colors ${expired ? 'opacity-60' : ''}`}
                        >
                          {/* Deal Info */}
                          <td className="py-3 px-4 max-w-[18rem]">
                            <DealSummary deal={summaryDeal(deal)} commitments={commitments} />
                          </td>

                          {/* Cashout */}
                          <td className="py-3 px-3">
                            <CashoutOffers deal={deal} />
                          </td>

                          {/* Payout */}
                          <td className="py-3 px-3 text-right">
                            <div className="font-semibold tabular-nums text-[var(--dp-text-primary)]">
                              ${formatMoney(deal.payout)}
                            </div>
                          </td>

                          {/* Retail */}
                          <td className="py-3 px-3 text-right tabular-nums text-[var(--dp-text-secondary)]">
                            {deal.retail > 0 ? `$${formatMoney(deal.retail)}` : '—'}
                          </td>

                          {/* Est. Profit */}
                          <td className="py-3 px-3 text-right">
                            <EstProfit profit={deal.estimatedProfit} expired={expired} />
                          </td>

                          {/* Best Card */}
                          <td className="py-3 px-3">
                            <BestCard best={bestCardForDeal(deal, paymentMethods)} expired={expired} />
                          </td>

                          {/* Expires */}
                          <td className="py-3 px-3 whitespace-nowrap">
                            <DealExpiry expiresAt={deal.expiresAt} />
                          </td>

                          {/* Buy At */}
                          <td className="py-3 px-3">
                            {expired ? <span className="text-[var(--dp-text-label)]">—</span> : <StoreLinks deal={deal} />}
                          </td>

                          {/* Actions */}
                          <td className="py-3 pl-3 pr-6 w-px whitespace-nowrap text-right">
                            {!expired && <LogPurchaseButton deal={deal} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ))}

    </div>
  );
}

// Name, image, UPC, note and tags: the same on the table and the phone cards.
function DealSummary({ deal, commitments }) {
  const { note, address, deliverTo, coupon } = parseDealNotes(deal.notes);
  const limit = dealLimitLabel(deal);
  const bought = dealBoughtLabel(deal, dealBoughtCount(deal, commitments));
  const conditions = dealConditionLabels(deal);
  const upc = deal.items?.[0]?.upcs?.[0];

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3">
        {deal.imageUrl ? (
          <img
            src={deal.imageUrl}
            alt={deal.name}
            className="w-10 h-10 rounded-lg object-contain bg-white/5 border border-[color:var(--dp-border)] flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] flex items-center justify-center text-[var(--dp-text-label)] flex-shrink-0">
            <Package size={16} />
          </div>
        )}
        <div className="min-w-0">
          <div className="font-semibold text-[var(--dp-text-primary)] truncate" title={deal.name}>
            {deal.name}
          </div>
          {upc && (
            <div className="text-[12px] text-[var(--dp-text-label)] font-mono truncate">UPC: {upc}</div>
          )}
          {note && <DealNote note={note} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 min-h-[22px]">
        {deal.featured && (
          <DealTag className="bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]">
            <Star size={9} className="fill-current" /> Featured
          </DealTag>
        )}
        {conditions.map((condition) => (
          <DealTag key={condition} className="bg-rose-500/15 text-rose-400">{condition}</DealTag>
        ))}
        {deliverTo && <DealTag className="bg-amber-500/15 text-amber-400">{deliverTo}</DealTag>}
        {bought && (
          <DealTag
            className={bought.reached ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}
            title={bought.reached ? "You've bought up to this deal's limit (purchases logged with Log Purchase)." : 'What you have bought on this deal with Log Purchase.'}
          >
            {bought.text}{bought.reached ? ' · limit reached' : ''}
          </DealTag>
        )}
        {limit && !(bought && bought.text.includes(' of ')) && (
          <DealTag
            className="bg-[var(--dp-hover-bg)] text-[var(--dp-text-secondary)]"
            title="The vendor limit ElectronicsBuyer sends for this deal."
          >
            {limit}
          </DealTag>
        )}
        {coupon && <CopyButton value={coupon} label={`Code ${coupon}`} name={`Copy code ${coupon}`} />}
        {address && <CopyButton value={address} label="Address" name="Copy Address" title={address} />}
      </div>
    </div>
  );
}

function DealTag({ className, title, children }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[12px] font-medium whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

function DealNote({ note }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = note.length > NOTE_PREVIEW_LENGTH;

  return (
    <div className="flex items-start gap-1.5 mt-0.5 text-[12px] text-[var(--dp-text-secondary)]">
      <span className={`min-w-0 ${expanded ? '' : 'line-clamp-1'}`}>{note}</span>
      {canExpand && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex-shrink-0 underline underline-offset-2 hover:text-[var(--dp-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] rounded"
        >
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

function CopyButton({ value, label, name, title }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Couldn't copy ${label}`);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      aria-label={copied ? 'Copied' : name}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[12px] font-medium whitespace-nowrap border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)]"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

const PROFIT_TONES = {
  gain: 'text-emerald-400',
  loss: 'text-rose-400',
  neutral: 'text-[var(--dp-text-primary)]',
};

function EstProfit({ profit, expired = false }) {
  if (!profit) return <span className="text-[var(--dp-text-label)]">—</span>;

  const { amount, pct, tone } = formatDealProfit(profit);
  return (
    <div className="tabular-nums">
      <div className={`text-sm font-bold ${PROFIT_TONES[expired ? 'neutral' : tone]}`}>{amount}</div>
      <div className="text-[12px] text-[var(--dp-text-label)]">{pct} ROI</div>
    </div>
  );
}

// The saved card that earns the most on a deal, what it earns and where, and
// the deal's profit with that cashback. With no saved cards it links to where
// cards are added.
function BestCard({ best, expired = false, inline = false }) {
  if (!best) {
    return (
      <Link to="/settings" state={PAYMENT_METHODS_STATE} className="text-[12px] text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)] underline underline-offset-2">
        Add a card
      </Link>
    );
  }
  if (!best.card) {
    return <span className="text-[var(--dp-text-label)]" title="None of your saved cards earn cashback at this deal's stores.">—</span>;
  }

  const rate = `${Math.round(best.rate * 100) / 100}%`;
  const earns = best.store ? `${rate} at ${best.store}` : rate;
  const profit = best.profit ? formatDealProfit(best.profit) : null;
  const roi = best.profit ? formatDealRoi(best.profit) : null;
  const cardLabel = best.card.last4 ? `${best.card.name} (${best.card.last4})` : best.card.name;
  const cashbackNote = best.cashback !== null ? `, $${formatMoney(best.cashback)} back on retail` : '';
  return (
    <div className={inline ? 'flex flex-wrap items-baseline gap-x-2' : 'mx-auto min-w-[9rem] max-w-[15rem] text-center'} title={`${cardLabel}: ${earns}${cashbackNote}`}>
      <div className="font-medium text-[var(--dp-text-primary)] break-words">{best.card.name}</div>
      <div className="text-[12px] text-[var(--dp-text-label)]">{earns}</div>
      {profit && (
        <div className={`tabular-nums text-sm font-bold ${PROFIT_TONES[expired ? 'neutral' : profit.tone]}`}>{profit.amount}</div>
      )}
      {roi && <div className="tabular-nums text-[12px] text-[var(--dp-text-label)]">{roi}</div>}
    </div>
  );
}

function CashoutName({ name }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium bg-[var(--dp-hover-bg)] text-[var(--dp-text-primary)] border border-[color:var(--dp-border)]">
      {name}
    </span>
  );
}

// A product row shows the deal of the cashout you can log a purchase with,
// since its note carries the coupon, address and limits that purchase needs.
// Otherwise it's the best-paying deal.
function summaryDeal(deal) {
  const offers = deal.offers || [deal];
  return offers.length > 1 ? offers.find((offer) => offer.connectionSupportsCommits) || deal : deal;
}

// Which cashouts pay for this product. With several, each shows its own payout,
// best first.
function CashoutOffers({ deal }) {
  const offers = deal.offers || [deal];
  if (offers.length === 1) {
    return (
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <CashoutName name={deal.connectionName} />
        <OpenOnCashout offer={deal} />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1.5">
      {offers.map((offer, index) => (
        <div key={`${offer.connectionId}-${offer.id}`} className="flex items-center gap-1.5 whitespace-nowrap">
          <CashoutName name={offer.connectionName} />
          <span className={`tabular-nums text-[12px] ${index === 0 ? 'font-semibold text-emerald-400' : 'text-[var(--dp-text-secondary)]'}`}>
            ${formatMoney(offer.payout)}
          </span>
          <OfferEnds expiresAt={offer.expiresAt} />
          <OpenOnCashout offer={offer} />
        </div>
      ))}
    </div>
  );
}

// Links to the deal on the cashout's website: the deal itself for Points4Days
// and EarnFromBuying, where the commitment and tracking are done, and the deals
// list for ElectronicsBuyer, whose API has no per-deal address.
function OpenOnCashout({ offer }) {
  if (!offer.dealUrl) return null;
  return (
    <a
      href={offer.dealUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open on ${offer.connectionName}`}
      title={offer.connectionSupportsCommits ? `Open on ${offer.connectionName}` : `Open on ${offer.connectionName} to commit`}
      className="inline-flex items-center justify-center p-1 max-md:min-h-11 max-md:min-w-11 rounded-md text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors"
    >
      <ExternalLink size={13} className="max-md:h-4 max-md:w-4" />
    </a>
  );
}

// Each cashout's deal can end on a different day, so a shared row says when
// each one ends next to its payout.
function OfferEnds({ expiresAt }) {
  const expiry = formatDealExpiry(expiresAt);
  if (!expiry) return null;
  return (
    <span className={`text-[12px] ${expiry.urgent || expiry.expired ? 'text-amber-400' : 'text-[var(--dp-text-label)]'}`}>
      · {expiry.expired ? 'ended' : 'ends'} {expiry.date}
    </span>
  );
}


function StoreLinks({ deal, large = false }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${large ? '' : 'min-w-[120px]'}`}>
      {groupStoreLinks(deal).map((link) => (
        <StoreLink key={link.url} link={link} large={large} />
      ))}
    </div>
  );
}

// Pledges already made to a cashout -- read from our own records, since the
// provider itself has no way to tell us which tracking number went with
// which commitment. Deal names come from the current live deals list when
// available; an expired/closed deal still shows its id.
// An active commitment whose sale has a tracking number the cashout doesn't
// have: it changed after committing, or the first send failed.
const needsTrackingSend = (c) => {
  const number = String(c.sale?.tracking_number || '').trim().toUpperCase();
  if (!number) return false;
  if (c.tracking_error) return true;
  return !(c.tracking_codes || []).some((code) => String(code).toUpperCase() === number);
};

// Purchases of one item that share the cashout's single commitment for it
// (bought more after committing) are one group: open rows of the same item on
// the same connection. Withdrawn rows stay on their own, as history.
function groupCommitments(commitments) {
  const groups = [];
  const byKey = new Map();
  for (const c of commitments) {
    const open = c.open_item_id && ['active', 'pending', 'committing'].includes(c.status);
    const key = open ? `${c.connection_id}:${c.open_item_id}` : `row:${c.id}`;
    if (!byKey.has(key)) {
      const group = { key, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).rows.push(c);
  }
  for (const g of groups) {
    g.committed = g.rows.filter((r) => r.status === 'active').reduce((n, r) => n + (Number(r.quantity) || 0), 0);
    g.waiting = g.rows.filter((r) => r.status !== 'active' && r.status !== 'withdrawn').reduce((n, r) => n + (Number(r.quantity) || 0), 0);
  }
  return groups;
}

const ACTION_BTN = 'px-2.5 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap';
const PRIMARY_BTN = `${ACTION_BTN} bg-[var(--dp-accent)] text-white hover:opacity-90 transition-opacity`;
const QUIET_BTN = `${ACTION_BTN} border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)] transition-colors`;

// What the cashout accepts as a tracking number (same rule as the API).
const TRACKING_PATTERN = /^[A-Za-z0-9-]{1,24}$/;

// A not-committed purchase that hasn't shipped: its tracking number can be
// added right here. It's saved on the sale, which brings up the usual "Commit
// now?" prompt (today's payout, the new total, insurance) -- nothing is
// committed or sent to the cashout until Commit is pressed there.
function TrackingEntry({ commitment }) {
  const invalidate = useInvalidate();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputId = `track-${commitment.id}`;

  const submit = async (e) => {
    e.preventDefault();
    const code = value.trim();
    if (!TRACKING_PATTERN.test(code)) {
      setError('Letters, digits and dashes only, 24 characters at most.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/sales/${commitment.sale_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: code }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not save the tracking number.');
      }
      setValue('');
      invalidate.sales();
      invalidate.cashouts();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!commitment.sale_id) return <span className="text-[var(--dp-text-label)]">—</span>;
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <label htmlFor={inputId} className="sr-only">Tracking number</label>
      <input
        id={inputId}
        type="text"
        maxLength={24}
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        placeholder="Add tracking"
        disabled={busy}
        className="min-w-0 flex-1 px-2 py-1.5 text-[11px] font-mono rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none focus:border-[var(--dp-accent)]"
      />
      <button type="submit" disabled={busy || !value.trim()}
        className="px-2 py-1.5 text-[11px] font-semibold rounded-lg whitespace-nowrap bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-40">
        {busy ? 'Saving…' : 'Add'}
      </button>
      {error && <span role="alert" className="sr-only">{error}</span>}
      {error && <span className="text-[11px] text-rose-400" aria-hidden="true">{error}</span>}
    </form>
  );
}

function CommitmentsPanel({ commitments, allDeals }) {
  const { deleteCommitment } = useCashoutMutations();
  const [openGroups, setOpenGroups] = useState(() => new Set());
  // One card per commitment until the 8-column table fits beside the sidebar
  // (the same breakpoint Live Deals switches to cards at).
  const isPhone = useMatchMedia(DEAL_CARDS_QUERY);

  if (commitments.length === 0) {
    return (
      <div className="p-6 text-center rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs text-[var(--dp-text-secondary)]">
        No commitments yet. Log Purchase on a deal commits to it.
      </div>
    );
  }

  // Not committed first (what still needs a tracking number or a commit),
  // then what's committed, then withdrawn history.
  const notCommitted = commitments.filter((c) => c.status === 'pending' || c.status === 'committing');
  const committedGroups = groupCommitments(commitments.filter((c) => c.status === 'active'));
  const withdrawn = commitments.filter((c) => c.status === 'withdrawn');
  const committedFor = (c) => committedGroups.find((g) => g.key === `${c.connection_id}:${c.open_item_id}`)?.committed || 0;
  const toggle = (key) => setOpenGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // One purchase off its commitment. When others share it, the commitment is
  // lowered by this purchase's units instead of withdrawn.
  const withdraw = async (commitment, group) => {
    const pending = commitment.status === 'pending';
    // Names the account when the item has several purchases, so it's clear which one.
    const account = commitment.sale?.inventory?.account?.name;
    const which = account && group && group.rows.length > 1 ? ` (bought on ${account})` : '';
    const shared = !pending && group && group.committed > commitment.quantity;
    if (!confirm(pending
      ? `Remove this${account ? ` ${account} purchase` : ''} from Commitments? Nothing was committed to the cashout, so nothing is sent there. The purchase and sale stay.`
      : shared
        ? `Take these ${commitment.quantity}${which} off your commitment? It goes from ${group.committed} to ${group.committed - commitment.quantity} with the cashout. The purchase and sale stay.`
        : 'Withdraw this commitment? The cashout frees the quantity back to the deal immediately.')) return;
    try {
      await deleteCommitment.mutateAsync({ id: commitment.id });
      toast.success(pending ? 'Removed. The purchase and sale are still there.' : shared ? `Commitment lowered to ${group.committed - commitment.quantity}.` : 'Commitment withdrawn.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const withdrawAll = async (group) => {
    const first = group.rows.find((r) => r.status === 'active');
    if (!first) return;
    if (!confirm(`Withdraw the whole commitment (${group.committed})? The cashout frees it back to the deal immediately. The purchases and sales stay.`)) return;
    try {
      await deleteCommitment.mutateAsync({ id: first.id, all: true });
      toast.success('Commitment withdrawn.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const itemInfo = (c) => {
    const deal = allDeals.find((d) => String(d.id) === c.external_deal_id);
    return {
      deal,
      itemName: c.sale?.inventory?.product_name || deal?.name || `Deal #${c.external_deal_id}`,
      upc: deal?.items?.[0]?.upcs?.[0],
    };
  };

  const statusCell = (c) => (
    <>
      {c.status === 'withdrawn' ? (
        <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[var(--dp-hover-bg)] text-[var(--dp-text-label)]">
          Withdrawn
        </span>
      ) : c.status === 'pending' || c.status === 'committing' ? (
        <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-sky-500/15 text-sky-300"
          title={c.sale?.tracking_number ? 'Has tracking, not committed to the cashout yet' : 'Logged before it shipped. Add its tracking number to commit.'}>
          {c.status === 'committing' ? 'Committing…' : 'Not committed'}
        </span>
      ) : c.sale?.workflow_status ? (
        <StatusChip status={c.sale.workflow_status} />
      ) : (
        <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-400">
          Committed
        </span>
      )}
      {c.status === 'pending' && c.commit_error && (
        <div className="mt-1 text-[11px] leading-snug text-rose-400 whitespace-normal" role="note">{c.commit_error}</div>
      )}
    </>
  );

  const trackingCell = (c) => (
    <>
      {c.tracking_codes?.length > 0 && (
        <div className="text-[11px] text-[var(--dp-text-secondary)] font-mono truncate" title={c.tracking_codes.join(', ')}>
          {c.tracking_codes.join(', ')}
        </div>
      )}
      {c.tracking_error && (
        <div className="text-[11px] text-rose-400 mt-0.5" title={c.tracking_error}>Tracking failed</div>
      )}
      {c.status === 'pending' && c.sale?.tracking_number && (
        <div className="text-[11px] text-[var(--dp-text-secondary)] font-mono truncate" title={c.sale.tracking_number}>{c.sale.tracking_number}</div>
      )}
      {c.status === 'pending' && !c.sale?.tracking_number && <TrackingEntry commitment={c} />}
      {!c.tracking_codes?.length && !c.tracking_error && c.status !== 'pending' && <span className="text-[var(--dp-text-label)]">—</span>}
    </>
  );

  const actionsCell = (c, group) => (
    <>
      {c.status === 'pending' && (
        <div className="inline-flex gap-1.5">
          {c.sale?.tracking_number && (
            <button type="button" onClick={() => offerPendingCommit(c.id)} className={PRIMARY_BTN}>
              {c.commit_error ? 'Try again' : 'Commit'}
            </button>
          )}
          <button type="button" onClick={() => withdraw(c, group)} className={QUIET_BTN}>Remove</button>
        </div>
      )}
      {c.status === 'active' && (
        <div className="inline-flex gap-1.5">
          {needsTrackingSend(c) && (
            <button
              type="button"
              onClick={() => offerTrackingSend({ commitment_id: c.id, tracking_number: c.sale.tracking_number, cashout: c.connection?.display_name, account: c.sale?.inventory?.account?.name || null })}
              className={PRIMARY_BTN}
            >
              Send tracking
            </button>
          )}
          <button type="button" onClick={() => withdraw(c, group)} className={QUIET_BTN}>
            {group && group.rows.length > 1 && group.committed > c.quantity ? 'Take off' : 'Withdraw'}
          </button>
        </div>
      )}
    </>
  );

  // One purchase's row: on its own, or nested under its item's group.
  const purchaseRow = (c, group, nested = false) => {
    const { deal, itemName, upc } = itemInfo(c);
    const unitCost = c.sale?.inventory?.unit_purchase_cost;
    const unitPayout = c.sale?.unit_price;
    return (
      <tr key={c.id} className={`hover:bg-[var(--dp-hover-bg)] transition-colors ${c.status === 'withdrawn' ? 'opacity-60' : ''} ${nested ? 'bg-[var(--dp-hover-bg)]/40' : ''}`}>
        <td className={`py-3 ${nested ? 'pl-12 pr-4' : 'px-4'}`}>
          <div className="flex items-start gap-3">
            {!nested && (deal?.imageUrl ? (
              <img
                src={deal.imageUrl}
                alt={itemName}
                className="w-10 h-10 rounded-lg object-contain bg-white/5 border border-[color:var(--dp-border)] flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] flex items-center justify-center text-[var(--dp-text-label)] flex-shrink-0">
                <Package size={16} />
              </div>
            ))}
            <div className="min-w-0">
              {!nested && <div className="font-semibold text-[var(--dp-text-primary)] truncate" title={itemName}>{itemName}</div>}
              {!nested && upc && <div className="text-[12px] text-[var(--dp-text-label)] font-mono truncate">UPC: {upc}</div>}
              <div className={`text-[12px] ${nested ? 'text-[var(--dp-text-secondary)]' : 'text-[var(--dp-text-label)] mt-0.5'}`}>
                Qty {c.quantity} · {new Date(c.created_at).toLocaleDateString()}
              </div>
              {c.status === 'pending' && group?.addsTo > 0 && (
                <div className="text-[11px] text-sky-300 mt-0.5">Adds to your {group.addsTo} committed</div>
              )}
            </div>
          </div>
        </td>
        <td className="py-3 px-3">
          {!nested && <CashoutName name={c.connection?.display_name || c.connection?.provider} />}
        </td>
        <td className="py-3 px-3"><AccountName rows={[c]} /></td>
        <td className="py-3 px-3 tabular-nums text-[var(--dp-text-secondary)]">
          {unitCost != null ? `$${formatMoney(unitCost)}` : '—'}
        </td>
        <td className="py-3 px-3">
          <div className="font-semibold tabular-nums text-[var(--dp-text-primary)]">
            {unitPayout != null ? `$${formatMoney(unitPayout)}` : '—'}
          </div>
        </td>
        {/* Status -- the sale's real workflow status when one exists
            (the same vocabulary the Statuses page uses), since that
            already implies "logged" without a separate badge. */}
        <td className="py-3 px-3">{statusCell(c)}</td>
        <td className="py-3 px-3">{trackingCell(c)}</td>
        <td className="py-3 pl-3 pr-6 whitespace-nowrap text-right">{actionsCell(c, group)}</td>
      </tr>
    );
  };

  // Several purchases on one commitment: a summary row that opens to them.
  const groupRows = (group) => {
    const first = group.rows[0];
    const { deal, itemName, upc } = itemInfo(first);
    const expanded = openGroups.has(group.key);
    const flagged = group.rows.some((r) => r.status === 'pending' && r.commit_error);
    return [
      <tr key={group.key} className="hover:bg-[var(--dp-hover-bg)] transition-colors">
        <td className="py-3 px-4">
          <div className="flex items-start gap-3">
            {deal?.imageUrl ? (
              <img src={deal.imageUrl} alt={itemName} className="w-10 h-10 rounded-lg object-contain bg-white/5 border border-[color:var(--dp-border)] flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] flex items-center justify-center text-[var(--dp-text-label)] flex-shrink-0">
                <Package size={16} />
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold text-[var(--dp-text-primary)] truncate" title={itemName}>{itemName}</div>
              {upc && <div className="text-[12px] text-[var(--dp-text-label)] font-mono truncate">UPC: {upc}</div>}
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={expanded}
                className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-accent)] hover:underline"
              >
                <ChevronDown size={12} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" />
                {group.rows.length} purchases
              </button>
            </div>
          </div>
        </td>
        <td className="py-3 px-3">
          <CashoutName name={first.connection?.display_name || first.connection?.provider} />
        </td>
        <td className="py-3 px-3"><AccountName rows={group.rows} /></td>
        <td className="py-3 px-3 text-[var(--dp-text-label)]">—</td>
        <td className="py-3 px-3">
          <div className="font-semibold tabular-nums text-[var(--dp-text-primary)]">
            {first.sale?.unit_price != null ? `$${formatMoney(first.sale.unit_price)}` : '—'}
          </div>
        </td>
        <td className="py-3 px-3">
          <div className="text-[12px] font-semibold text-[var(--dp-text-primary)] tabular-nums">
            {group.committed > 0 ? `${group.committed} committed` : 'Not committed'}
          </div>
          {group.waiting > 0 && (
            <div className="text-[11px] text-sky-300 tabular-nums">{group.waiting} waiting to ship</div>
          )}
          {flagged && <div className="text-[11px] text-rose-400">Needs attention</div>}
        </td>
        <td className="py-3 px-3 text-[11px] text-[var(--dp-text-secondary)]">
          {group.rows.filter((r) => r.tracking_codes?.length).length} of {group.rows.length} sent
        </td>
        <td className="py-3 pl-3 pr-6 whitespace-nowrap text-right">
          {group.committed > 0 && (
            <button type="button" onClick={() => withdrawAll(group)} className={QUIET_BTN}>Withdraw all</button>
          )}
        </td>
      </tr>,
      ...(expanded ? group.rows.map((c) => purchaseRow(c, group, true)) : []),
    ];
  };

  // ── Phone layout: same cells as the table rows, laid out as a card ──
  const phoneThumb = (deal, itemName) => (deal?.imageUrl ? (
    <img src={deal.imageUrl} alt={itemName} className="w-11 h-11 rounded-lg object-contain bg-white/5 border border-[color:var(--dp-border)] flex-shrink-0" />
  ) : (
    <div className="w-11 h-11 rounded-lg bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] flex items-center justify-center text-[var(--dp-text-label)] flex-shrink-0">
      <Package size={16} />
    </div>
  ));
  const phoneField = (label, value) => (
    <div className="min-w-0">
      <div className="text-[11px] text-[var(--dp-text-label)]">{label}</div>
      <div className="mt-0.5 text-[13px]">{value}</div>
    </div>
  );

  const purchaseCard = (c, group, nested = false) => {
    const { deal, itemName, upc } = itemInfo(c);
    const unitCost = c.sale?.inventory?.unit_purchase_cost;
    const unitPayout = c.sale?.unit_price;
    return (
      <li key={c.id} className={`px-4 py-3.5 ${c.status === 'withdrawn' ? 'opacity-60' : ''} ${nested ? 'bg-[var(--dp-hover-bg)]/40 pl-6' : ''}`}>
        <div className="flex items-start gap-3">
          {!nested && phoneThumb(deal, itemName)}
          <div className="min-w-0 flex-1">
            {!nested && <div className="font-semibold text-sm leading-snug text-[var(--dp-text-primary)]">{itemName}</div>}
            {!nested && upc && <div className="text-[12px] text-[var(--dp-text-label)] font-mono">UPC: {upc}</div>}
            <div className={`text-[12px] ${nested ? 'text-[var(--dp-text-secondary)]' : 'text-[var(--dp-text-label)] mt-0.5'}`}>
              Qty {c.quantity} · {new Date(c.created_at).toLocaleDateString()}
            </div>
            {c.status === 'pending' && group?.addsTo > 0 && (
              <div className="text-[11px] text-sky-300 mt-0.5">Adds to your {group.addsTo} committed</div>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2.5">
          {!nested && phoneField('Cashout', <CashoutName name={c.connection?.display_name || c.connection?.provider} />)}
          {phoneField('Account', <AccountName rows={[c]} />)}
          {phoneField('Status', statusCell(c))}
          {phoneField('Bought at', <span className="tabular-nums text-[var(--dp-text-secondary)]">{unitCost != null ? `$${formatMoney(unitCost)}` : '—'}</span>)}
          {phoneField('Committed at', <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">{unitPayout != null ? `$${formatMoney(unitPayout)}` : '—'}</span>)}
        </div>
        <div className="mt-2.5">{phoneField('Tracking', trackingCell(c))}</div>
        {(c.status === 'pending' || c.status === 'active') && <div className="mt-3 flex justify-end">{actionsCell(c, group)}</div>}
      </li>
    );
  };

  const groupCard = (group) => {
    const first = group.rows[0];
    const { deal, itemName, upc } = itemInfo(first);
    const expanded = openGroups.has(group.key);
    const flagged = group.rows.some((r) => r.status === 'pending' && r.commit_error);
    return (
      <li key={group.key}>
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-3">
            {phoneThumb(deal, itemName)}
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm leading-snug text-[var(--dp-text-primary)]">{itemName}</div>
              {upc && <div className="text-[12px] text-[var(--dp-text-label)] font-mono">UPC: {upc}</div>}
              <button type="button" onClick={() => toggle(group.key)} aria-expanded={expanded}
                className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dp-accent)]">
                <ChevronDown size={12} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} aria-hidden="true" />
                {group.rows.length} purchases
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-2.5">
            {phoneField('Cashout', <CashoutName name={first.connection?.display_name || first.connection?.provider} />)}
            {phoneField('Account', <AccountName rows={group.rows} />)}
            {phoneField('Committed at', <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">{first.sale?.unit_price != null ? `$${formatMoney(first.sale.unit_price)}` : '—'}</span>)}
            {phoneField('Status', (
              <>
                <div className="font-semibold tabular-nums text-[var(--dp-text-primary)]">{group.committed > 0 ? `${group.committed} committed` : 'Not committed'}</div>
                {group.waiting > 0 && <div className="text-[11px] text-sky-300 tabular-nums">{group.waiting} waiting to ship</div>}
                {flagged && <div className="text-[11px] text-rose-400">Needs attention</div>}
              </>
            ))}
            {phoneField('Tracking', <span className="text-[12px] text-[var(--dp-text-secondary)]">{group.rows.filter((r) => r.tracking_codes?.length).length} of {group.rows.length} sent</span>)}
          </div>
          {group.committed > 0 && (
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => withdrawAll(group)} className={QUIET_BTN}>Withdraw all</button>
            </div>
          )}
        </div>
        {expanded && <ul className="divide-y divide-[color:var(--dp-border)] border-t border-[color:var(--dp-border)]">{group.rows.map((c) => purchaseCard(c, group, true))}</ul>}
      </li>
    );
  };

  const phoneSection = (title, count, hint) => (
    <li className="bg-[var(--dp-hover-bg)] py-2 px-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-secondary)]">{title}</span>
      <span className="ml-1.5 text-[11px] text-[var(--dp-text-label)] tabular-nums">{count}</span>
      {hint && <span className="block text-[11px] text-[var(--dp-text-label)] mt-0.5">{hint}</span>}
    </li>
  );

  if (isPhone) {
    return (
      <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-hidden shadow-sm">
        <ul className="divide-y divide-[color:var(--dp-border)]">
          {notCommitted.length > 0 && phoneSection('Not committed', notCommitted.length, 'Logged, not sent to the cashout yet. Add the tracking number when it ships to commit it.')}
          {notCommitted.map((c) => purchaseCard(c, { rows: [c], committed: 0, addsTo: committedFor(c) }))}
          {committedGroups.length > 0 && phoneSection('Committed', committedGroups.length)}
          {committedGroups.map((group) => (group.rows.length > 1 ? groupCard(group) : purchaseCard(group.rows[0], group)))}
          {withdrawn.length > 0 && phoneSection('Withdrawn', withdrawn.length)}
          {withdrawn.map((c) => purchaseCard(c, null))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left border-collapse text-xs">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[7%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[color:var(--dp-border)] text-[var(--dp-text-label)] uppercase font-semibold text-[12px] tracking-wider align-top">
              <th className="py-3 px-4">Item</th>
              <th className="py-3 px-3">Cashout</th>
              <th className="py-3 px-3">Account</th>
              <th className="py-3 px-3">Bought At</th>
              <th className="py-3 px-3">Committed At</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Tracking</th>
              <th className="py-3 pl-3 pr-6"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--dp-border)]">
            {notCommitted.length > 0 && <SectionRow title="Not committed" count={notCommitted.length}
              hint="Logged, not sent to the cashout yet. Add the tracking number when it ships to commit it." />}
            {notCommitted.map((c) => purchaseRow(c, { rows: [c], committed: 0, addsTo: committedFor(c) }))}
            {committedGroups.length > 0 && <SectionRow title="Committed" count={committedGroups.length} />}
            {committedGroups.flatMap((group) => (group.rows.length > 1 ? groupRows(group) : [purchaseRow(group.rows[0], group)]))}
            {withdrawn.length > 0 && <SectionRow title="Withdrawn" count={withdrawn.length} />}
            {withdrawn.map((c) => purchaseRow(c, null))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountName({ rows }) {
  const { label, title, mixed } = commitmentAccountSummary(rows);
  if (!label) return <span className="text-[var(--dp-text-label)]" title="No account">—</span>;
  return (
    <span className={`block truncate text-[12px] ${mixed ? 'text-[var(--dp-text-secondary)]' : 'text-[var(--dp-text-primary)]'}`} title={title}>
      {label}
    </span>
  );
}

// A heading row inside the Commitments table.
function SectionRow({ title, count, hint }) {
  return (
    <tr className="bg-[var(--dp-hover-bg)]">
      <th colSpan={8} scope="rowgroup" className="py-2 px-4 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-secondary)]">{title}</span>
        <span className="ml-1.5 text-[11px] text-[var(--dp-text-label)] tabular-nums">{count}</span>
        {hint && <span className="block text-[11px] font-normal normal-case text-[var(--dp-text-label)] mt-0.5">{hint}</span>}
      </th>
    </tr>
  );
}

// A sale's workflow status, in the same vocabulary and colour the Statuses
// page uses for it -- so "Outbound"/"Paid" here means the same thing it does
// there, instead of a separate made-up label.
function StatusChip({ status }) {
  const visual = statusVisual(status);
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold"
      style={{ backgroundColor: `color-mix(in srgb, ${visual.color} 15%, transparent)`, color: visual.color }}
    >
      {displayLabel(status)}
    </span>
  );
}

// Commits to the cashout, submits tracking, and records the purchase + sale
// together -- for an item you've already bought and shipped.
// One button per product. When several cashouts pay for it, the form asks
// which one, starting on the best payout.
function LogPurchaseButton({ deal }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2.5 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap bg-[var(--dp-accent)] text-white hover:opacity-90 transition-opacity"
      >
        Log Purchase
      </button>
      {open && <LogPurchaseModal product={deal} onClose={() => setOpen(false)} />}
    </>
  );
}

// The Log Purchase window is opened from inside a deal's table cell, which is
// right-aligned and doesn't wrap -- a window placed there inherits both. So
// it's rendered into the page's workspace instead, which still carries the
// theme's form styles (document.body wouldn't).
function ModalLayer({ children }) {
  const host = document.querySelector('.carbon-workspace, .glass-workspace') || document.body;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 text-left whitespace-normal">
      {children}
    </div>,
    host,
  );
}

// The same field look as Add Transaction: label above, full-width control.
const LP_INPUT = 'w-full px-3 py-2 text-sm rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors';

function LpField({ id, label, className = '', children }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-[var(--dp-text-secondary)] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function LpSection({ icon, title, tone, children }) {
  return (
    <section className="card p-4 space-y-4">
      <div className="flex items-center gap-2">
        {React.createElement(icon, { className: `w-4 h-4 ${tone}`, 'aria-hidden': 'true' })}
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${tone}`}>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function DollarInput({ id, value, onChange }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--dp-text-label)]" aria-hidden="true">$</span>
      <input id={id} type="number" inputMode="decimal" step="0.01" min="0" value={value} onChange={onChange} className={`${LP_INPUT} pl-7`} />
    </div>
  );
}

// The Log Purchase window's frame for its confirm and saved screens.
function ModalShell({ modalRef, title, subtitle, onClose, busy = false, children }) {
  return (
    <ModalLayer>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-xl rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
          <div>
            <h3 className="font-bold text-base text-[var(--dp-text-primary)]">{title}</h3>
            <p className="text-[11px] text-[var(--dp-text-secondary)] mt-0.5 truncate max-w-xs" title={subtitle}>{subtitle}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </ModalLayer>
  );
}

const nameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// One line per item in the picker: its name plus the UPC, which tells two
// colors apart when EB's names are close.
const itemOptionLabel = (item) => {
  const upc = item.upcs?.[0];
  return upc ? `${item.name} · UPC ${upc}` : item.name;
};

// Under the picker: what EB says about the chosen item.
function ItemFacts({ item }) {
  const facts = [
    item.condition && item.condition !== 'new' ? item.condition.replace(/_/g, ' ') : null,
    item.upcs?.length ? `UPC ${item.upcs.join(', ')}` : null,
    item.remainingPercentage != null ? `${Math.round(item.remainingPercentage)}% of the limit left` : null,
    item.vendorLimit ? `store limit ${item.vendorLimit}` : null,
  ].filter(Boolean);
  if (!facts.length) return null;
  return <p className="mt-1.5 text-[11px] text-[var(--dp-text-secondary)]">{facts.join(' · ')}</p>;
}

function LogPurchaseModal({ product, onClose }) {
  const offers = product.offers || [product];
  const [offerIndex, setOfferIndex] = useState(0);
  const deal = offers[offerIndex];
  const { data: platforms = [] } = usePlatforms();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { logPurchase } = useCashoutMutations();
  const { data: allCommitments = [] } = useCashoutCommitments();
  const vendors = useMemo(() => platforms.filter((p) => p.type === 'Vendor'), [platforms]);
  const cashoutGroups = useMemo(() => platforms.filter((p) => p.type === 'Cashout'), [platforms]);
  // Points4Days can't take a commitment from here yet, so this only saves the
  // purchase and sale, with the tracking number on the sale.
  const recordOnly = !deal.connectionSupportsCommits;
  // The cashout group the sale goes to: the connection's linked one, or picked
  // here. Preselected by name (Points4Days -> a "POINTS4DAYS" group).
  const needsSaleTo = !deal.connectionPlatformId;
  // The lists can still be loading when the form opens, so the preselected
  // store and group are worked out on each render until the user picks one.
  const [pickedSaleTo, setSaleToId] = useState(null);
  const saleToId = pickedSaleTo ?? (() => {
    // The cashout's name first ("Points4Days"), then its short id ("p4d").
    for (const name of [deal.connectionName, deal.connectionProvider].map(nameKey).filter(Boolean)) {
      const match = cashoutGroups.find((g) => nameKey(g.name) === name);
      if (match) return match.id;
    }
    return '';
  })();
  const items = deal.items || [];
  const dealStores = useMemo(() => dealStoreNames(deal), [deal]);

  // A deal with several items (one per color, size or model) starts with none
  // picked: each is its own commitment with EB, so the right one has to be a
  // choice, not whatever EB happens to list first.
  const onlyItemId = (list) => (list?.length === 1 ? list[0].id : '');
  const [itemId, setItemId] = useState(() => onlyItemId(items));
  // Another cashout's deal has its own items and its own group to sell to.
  const pickCashout = (index) => {
    setOfferIndex(index);
    setItemId(onlyItemId(offers[index].items));
    setSaleToId(null);
    setError(null);
  };
  const [quantity, setQuantity] = useState(1);
  const [pickedVendor, setVendorId] = useState(null);
  // null until picked: then the last account used at the store is preselected.
  const [pickedAccountId, setAccountId] = useState(null);
  const vendorId = pickedVendor ?? (vendors.find((v) => dealStores.map(nameKey).includes(nameKey(v.name)))?.id || '');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [unitCost, setUnitCost] = useState(product.retail || deal.retail || 0);
  const [salesTax, setSalesTax] = useState(0);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [insuredValue, setInsuredValue] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState(null);

  const selectedVendor = vendors.find((v) => v.id === vendorId);
  // Optional login at that store (Data Setup > Accounts). Only one of the
  // picked store's accounts is ever sent.
  const storeAccounts = useMemo(() => vendors.find((v) => v.id === vendorId)?.accounts || [], [vendors, vendorId]);
  // The account on your latest cashout purchase at this store (the list comes
  // newest first), so the usual login is already picked.
  const lastAccountId = useMemo(() => allCommitments.find((c) => c.sale?.inventory?.vendor_id === vendorId
    && c.sale?.inventory?.account_id)?.sale.inventory.account_id || '', [allCommitments, vendorId]);
  const wantedAccountId = pickedAccountId ?? lastAccountId;
  const accountId = storeAccounts.some((a) => a.id === wantedAccountId) ? wantedAccountId : '';
  const autoPickedAccount = pickedAccountId === null && Boolean(accountId);
  const selectedPaymentMethod = paymentMethods.find((m) => m.id === paymentMethodId);
  const taxExempt = Boolean(selectedVendor?.tax_exempt_place);
  // Same rule as Add Transaction: the card's rate for this store when it has
  // one (e.g. 5% at Amazon), else its default, on the whole charge with tax.
  const cashbackRate = effectiveCashbackRate({ payment_method: selectedPaymentMethod, vendor: selectedVendor });
  const cashbackBase = batchCost({
    unit_purchase_cost: Number(unitCost) || 0,
    qty_purchased: quantity,
    sales_tax: taxExempt ? 0 : Number(salesTax) || 0,
  });
  const cashbackEarned = Math.round(cashbackBase * (cashbackRate / 100) * 100) / 100;
  const selectedItem = items.find((i) => i.id === itemId);
  // Buying more of an item already committed (or logged and waiting to ship):
  // this purchase is its own record, and its units are added to the item's
  // one commitment with the cashout when it ships.
  const already = useMemo(() => {
    const open = itemId ? allCommitments.filter((c) => c.connection_id === deal.connectionId
      && String(c.external_item_id) === String(itemId) && c.open_item_id
      && ['active', 'pending', 'committing'].includes(c.status)) : [];
    const sum = (list) => list.reduce((n, c) => n + (Number(c.quantity) || 0), 0);
    // Units of this item already bought on each store account (stores cap
    // how many one account can buy).
    const byAccount = new Map();
    for (const c of open) {
      const name = c.sale?.inventory?.account?.name;
      if (name) byAccount.set(name, (byAccount.get(name) || 0) + (Number(c.quantity) || 0));
    }
    return {
      committed: sum(open.filter((c) => c.status === 'active')),
      waiting: sum(open.filter((c) => c.status !== 'active')),
      byAccount: [...byAccount],
    };
  }, [allCommitments, deal.connectionId, itemId]);
  const addsToExisting = !recordOnly && (already.committed > 0 || already.waiting > 0);

  const modalRef = useModalKeyboard(true, () => !logPurchase.isPending && onClose());

  // 'form' -> (EB only) 'confirm' -> saved. Points4Days goes from 'form'
  // straight to 'saved', which reminds you to commit on their website.
  const [stage, setStage] = useState('form');
  // The keyboard hook only places focus when the window first opens, so each
  // new screen moves it itself. The confirm screen starts on Back, so Enter
  // can't commit by accident.
  useEffect(() => {
    if (stage === 'form') return;
    modalRef.current?.querySelector('[data-autofocus]')?.focus();
  }, [stage, modalRef]);
  const tracking = trackingNumber.trim();
  const totalPayout = Math.round(Number(deal.payout) * quantity * 100) / 100;

  const validate = () => {
    if (!itemId) return 'Pick the exact item you bought (color, size or model).';
    if (!vendorId) return 'Pick the store you bought it from.';
    if (!paymentMethodId) return 'Pick the card or account you paid with.';
    if (needsSaleTo && !saleToId) return 'Pick which cashout group you sold it to.';
    if (!tracking && recordOnly) return 'A tracking number is required -- this is for an item that has already shipped.';
    return null;
  };

  const save = async () => {
    setError(null);
    try {
      const result = await logPurchase.mutateAsync({
        connectionId: deal.connectionId,
        deal_id: deal.id,
        item_id: itemId,
        deal_name: deal.name,
        item_name: selectedItem?.name,
        quantity,
        tracking_codes: tracking ? [tracking] : [],
        insured_value: !recordOnly && tracking && insuredValue ? Number(insuredValue) : undefined,
        platform_id: needsSaleTo ? saleToId : undefined,
        vendor_id: vendorId,
        account_id: accountId || undefined,
        payment_method_id: paymentMethodId,
        unit_cost: Number(unitCost) || 0,
        tax_exempt: taxExempt,
        sales_tax: taxExempt ? 0 : Number(salesTax) || 0,
        cashback_rate: cashbackRate || undefined,
        cashback_earned: cashbackEarned || undefined,
        unit_payout: deal.payout,
        purchase_date: purchaseDate,
      });
      if (recordOnly) {
        setStage('saved');
        return;
      }
      if (result.commitError) {
        toast.warning(`Logged, but not committed to ${deal.connectionName}.`, { description: result.commitError, duration: 15000 });
        onClose();
        return;
      }
      if ((result.commitPending ?? result.commit_pending) && result.addsToCommitment) {
        toast.success(`Logged as its own purchase. Not committed to ${deal.connectionName} yet.`, {
          description: `When it ships, add the tracking number and these ${quantity} will be added to your commitment for this item.`,
        });
        onClose();
        return;
      }
      if (result.addedTo) {
        toast.success(`Logged and added to your commitment: now ${result.addedTo} with ${deal.connectionName}.`, {
          description: (result.trackingSubmitted ?? result.tracking_submitted)
            ? (result.trackingShared ? "That tracking number was already sent with another item, so it wasn't sent again." : 'Tracking sent to the cashout.')
            : (result.trackingError || 'Tracking failed to send. Send it again from the Commitments section.'),
        });
        onClose();
        return;
      }
      if (result.commitPending ?? result.commit_pending) {
        toast.success(`Logged. Not committed to ${deal.connectionName} yet.`, {
          description: "Add the tracking number when it ships, and you'll be asked to commit then, at that day's payout.",
        });
        onClose();
        return;
      }
      if (result.trackingShared && (result.trackingSubmitted ?? result.tracking_submitted)) {
        toast.success('Committed and logged.', {
          description: `That tracking number was already sent to ${deal.connectionName} with another item, so it wasn't sent again.`,
        });
      } else if (result.trackingSubmitted ?? result.tracking_submitted) {
        toast.success('Committed and logged -- tracking sent to the cashout.');
      } else {
        toast.success('Committed and logged, but tracking failed to send.', {
          description: result.tracking_error || 'Send it again with Send tracking in the Commitments section.',
        });
      }
      onClose();
    } catch (err) {
      // A failed commit saves nothing, so the form is the place to fix it.
      setStage('form');
      setError(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const problem = validate();
    if (problem) return setError(problem);
    // EB's commit is binding, so it gets one more look before it's sent.
    // With no tracking number nothing is committed yet, so there's nothing to confirm.
    if (!recordOnly && tracking) return setStage('confirm');
    await save();
  };

  const copyTracking = async () => {
    try {
      await navigator.clipboard.writeText(tracking);
      toast.success('Tracking number copied');
    } catch {
      toast.error("Couldn't copy the tracking number");
    }
  };

  if (stage === 'confirm') {
    return (
      <ModalShell modalRef={modalRef} title={already.committed ? 'Add to your commitment?' : 'Commit to this deal?'} subtitle={product.name} onClose={onClose} busy={logPurchase.isPending}>
        <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          {already.committed
            ? `This raises your binding commitment with ${deal.connectionName} for this item from ${already.committed} to ${already.committed + Number(quantity)}. It's sent as soon as you press Commit, along with your tracking number.`
            : `This is a real, binding pledge to ${deal.connectionName}. It's sent as soon as you press Commit, along with your tracking number.`}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-[var(--dp-text-label)]">Item</dt>
          <dd className="text-[var(--dp-text-primary)] font-semibold">
            {selectedItem?.name || deal.name}
            {items.length > 1 && (
              <span className="block font-normal text-[11px] text-[var(--dp-text-secondary)]">
                One of {items.length} items in this deal. Make sure it's the exact one you bought.
              </span>
            )}
          </dd>
          <dt className="text-[var(--dp-text-label)]">Quantity</dt>
          <dd className="text-[var(--dp-text-primary)] tabular-nums">{quantity}</dd>
          {accountId && <>
            <dt className="text-[var(--dp-text-label)]">Account</dt>
            <dd className="text-[var(--dp-text-primary)]">{storeAccounts.find((a) => a.id === accountId)?.name}</dd>
          </>}
          <dt className="text-[var(--dp-text-label)]">Payout</dt>
          <dd className="text-[var(--dp-text-primary)] tabular-nums">${formatMoney(deal.payout)} each, ${formatMoney(totalPayout)} total</dd>
          <dt className="text-[var(--dp-text-label)]">Tracking</dt>
          <dd className="text-[var(--dp-text-primary)] font-mono break-all">{tracking}</dd>
          {insuredValue && <>
            <dt className="text-[var(--dp-text-label)]">Insured value</dt>
            <dd className="text-[var(--dp-text-primary)] tabular-nums">${formatMoney(Number(insuredValue))}</dd>
          </>}
        </dl>
        {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-3">
          <button type="button" data-autofocus onClick={() => setStage('form')} disabled={logPurchase.isPending}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
            Back
          </button>
          <button type="button" onClick={save} disabled={logPurchase.isPending}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-50">
            {logPurchase.isPending && <RefreshCw size={12} className="animate-spin" />}
            {logPurchase.isPending ? 'Committing…' : 'Commit'}
          </button>
        </div>
      </ModalShell>
    );
  }

  if (stage === 'saved') {
    return (
      <ModalShell modalRef={modalRef} title={`Saved. Now commit on ${deal.connectionName}`} subtitle={product.name} onClose={onClose}>
        <p className="text-xs text-[var(--dp-text-secondary)]">
          The purchase and its sale are in Profit Tracker. {deal.connectionName} doesn't know about them yet: commit to the deal and send this tracking number on their website.
        </p>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-hover-bg)] px-3 py-2">
          <span className="text-xs font-mono text-[var(--dp-text-primary)] break-all">{tracking}</span>
          <button type="button" onClick={copyTracking}
            className="shrink-0 px-2 py-1 text-[11px] font-medium rounded-md border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-card-bg)]">
            Copy
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-3">
          <button type="button" data-autofocus={deal.dealUrl ? undefined : true} onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
            Done
          </button>
          {deal.dealUrl && (
            <a data-autofocus href={deal.dealUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90">
              Open on {deal.connectionName} <ExternalLink size={12} />
            </a>
          )}
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalLayer>
      <form
        ref={modalRef}
        onSubmit={submit}
        aria-label="Log Purchase"
        className="w-full max-w-2xl rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-[color:var(--dp-border)]">
          <div className="min-w-0">
            <h3 className="font-bold text-base text-[var(--dp-text-primary)]">Log Purchase</h3>
            <p className="text-xs text-[var(--dp-text-secondary)] mt-0.5 truncate" title={product.name}>{product.name}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="shrink-0 text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <LpSection icon={DollarSign} title="Cashout" tone="text-green-400">
            {(offers.length > 1 || needsSaleTo || items.length > 1) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {offers.length > 1 && (
                  <LpField id="lp-cashout" label="Cashout">
                    <select id="lp-cashout" value={offerIndex} onChange={(e) => pickCashout(Number(e.target.value))} className={LP_INPUT}>
                      {offers.map((offer, index) => (
                        <option key={`${offer.connectionId}-${offer.id}`} value={index}>
                          {offer.connectionName} -- ${formatMoney(offer.payout)}
                        </option>
                      ))}
                    </select>
                  </LpField>
                )}
                {needsSaleTo && (
                  <LpField id="lp-saleto" label="Sold to">
                    <select id="lp-saleto" value={saleToId} onChange={(e) => setSaleToId(e.target.value)} className={LP_INPUT}>
                      <option value="">Select a cashout group…</option>
                      {cashoutGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </LpField>
                )}
                {items.length > 1 && (
                  <LpField id="lp-item" label="Which item (color, size or model)" className="sm:col-span-2">
                    <select id="lp-item" value={itemId} onChange={(e) => { setItemId(e.target.value); setError(null); }}
                      className={`${LP_INPUT} ${itemId ? '' : 'text-[var(--dp-text-label)]'}`}>
                      <option value="" disabled>Select the exact item you bought…</option>
                      {items.map((item) => <option key={item.id} value={item.id}>{itemOptionLabel(item)}</option>)}
                    </select>
                    {selectedItem && <ItemFacts item={selectedItem} />}
                  </LpField>
                )}
              </div>
            )}
            <p className="text-sm text-[var(--dp-text-secondary)]">
              {deal.connectionName} pays <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">${formatMoney(deal.payout)}</span> each
              {quantity > 1 && <> · <span className="tabular-nums">${formatMoney(totalPayout)}</span> total</>}
            </p>
          </LpSection>

          <LpSection icon={ShoppingCart} title="Purchase Details" tone="text-blue-400">
            <div className="grid grid-cols-2 gap-4">
              <LpField id="lp-cost" label="Unit cost (what you paid)">
                <DollarInput id="lp-cost" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </LpField>
              <LpField id="lp-qty" label="Quantity">
                <input id="lp-qty" type="number" inputMode="decimal" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))} className={LP_INPUT} />
              </LpField>
              <LpField id="lp-tax" label="Sales tax">
                {taxExempt ? (
                  <p className={`${LP_INPUT} text-[var(--dp-text-secondary)]`}>$0.00 (tax-exempt store)</p>
                ) : (
                  <DollarInput id="lp-tax" value={salesTax} onChange={(e) => setSalesTax(e.target.value)} />
                )}
              </LpField>
              <LpField id="lp-date" label="Purchase date">
                <input id="lp-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={LP_INPUT} />
              </LpField>
            </div>
          </LpSection>

          <LpSection icon={CreditCard} title="Store & Payment" tone="text-pink-400">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <LpField id="lp-store" label="Store">
                <select id="lp-store" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setAccountId(null); }} className={LP_INPUT}>
                  <option value="">Select a store…</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </LpField>
              {/* Only when the store has accounts; under Store on every width. */}
              {storeAccounts.length > 0 && (
                <LpField id="lp-account" label="Account (optional)" className="sm:order-last">
                  <select id="lp-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={LP_INPUT}>
                    <option value="">No account</option>
                    {storeAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                  </select>
                  {autoPickedAccount && <p className="mt-1 text-[11px] text-[var(--dp-text-label)]">Your last account at this store.</p>}
                  {already.byAccount.length > 0 && (
                    <p className="mt-1 text-[11px] text-[var(--dp-text-secondary)]">
                      Already bought: {already.byAccount.map(([name, qty]) => `${name} ${qty}`).join(' · ')}
                    </p>
                  )}
                </LpField>
              )}
              <LpField id="lp-pay" label="Payment method">
                <select id="lp-pay" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className={LP_INPUT}>
                  <option value="">Select a card…</option>
                  {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </LpField>
              <div>
                <span className="block text-xs font-medium text-[var(--dp-text-secondary)] mb-1.5">Cashback</span>
                <p className={`${LP_INPUT} tabular-nums text-[var(--dp-text-secondary)]`}>
                  {cashbackRate ? `$${cashbackEarned.toFixed(2)} (${cashbackRate}%)` : '—'}
                </p>
              </div>
            </div>
          </LpSection>

          <LpSection icon={Truck} title="Shipping" tone="text-amber-400">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LpField id="lp-tracking" label="Tracking number" className={!recordOnly && tracking ? '' : 'sm:col-span-2'}>
                <input id="lp-tracking" type="text" maxLength={24} value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder={recordOnly ? '1Z999AA10123456784' : 'Blank if it hasn’t shipped yet'}
                  className={`${LP_INPUT} font-mono`} />
              </LpField>
              {!recordOnly && tracking && (
                <LpField id="lp-insured" label="Insured value (optional)">
                  <input id="lp-insured" type="number" inputMode="decimal" min="200" max="1500" step="0.01" value={insuredValue} onChange={(e) => setInsuredValue(e.target.value)}
                    placeholder="$200–$1,500" className={LP_INPUT} />
                </LpField>
              )}
            </div>
          </LpSection>

          {addsToExisting && (
            <p className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2" data-testid="adds-to-commitment">
              {already.committed > 0
                ? `You already have ${already.committed} committed for this item${already.waiting ? ` and ${already.waiting} waiting to ship` : ''}. This is logged as its own purchase, and its ${quantity} ${tracking ? 'are added to that commitment now' : 'are added to that commitment when it ships'}.`
                : `You already have ${already.waiting} of this item logged and waiting to ship. This is logged as its own purchase; each one is committed when its tracking number is added.`}
            </p>
          )}
          {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 border-t border-[color:var(--dp-border)]">
          <p className={`flex-1 text-xs ${!recordOnly && tracking ? 'text-amber-400' : 'text-[var(--dp-text-secondary)]'}`}>
            {recordOnly
              ? `Saved here only. It doesn't commit or send tracking to ${deal.connectionName}; do that on their site.`
              : tracking
                ? `Commits to ${deal.connectionName} now, a real, binding pledge.`
                : `No tracking yet: saves without committing to ${deal.connectionName}. You'll be asked to commit when you add it.`}
          </p>
          <div className="flex items-center justify-end gap-2 shrink-0">
            <button type="button" onClick={onClose} disabled={logPurchase.isPending}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
              Cancel
            </button>
            <button type="submit" disabled={logPurchase.isPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-50">
              {logPurchase.isPending && <RefreshCw size={12} className="animate-spin" />}
              {recordOnly || !tracking
                ? (logPurchase.isPending ? 'Saving…' : 'Log Purchase')
                : 'Commit & Log Purchase'}
            </button>
          </div>
        </div>
      </form>
    </ModalLayer>
  );
}

function DealCard({ deal, paymentMethods, commitments }) {
  const expired = isDealExpired(deal);

  return (
    <article className={`p-3.5 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs flex flex-col gap-3 h-full ${expired ? 'opacity-60' : ''}`}>
      <DealSummary deal={summaryDeal(deal)} commitments={commitments} />

      <dl className="grid grid-cols-3 gap-2">
        <div>
          <dt className="text-[12px] text-[var(--dp-text-label)] uppercase tracking-wider">Payout</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-[var(--dp-text-primary)]">${formatMoney(deal.payout)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--dp-text-label)] uppercase tracking-wider">Retail</dt>
          <dd className="mt-0.5 tabular-nums text-[var(--dp-text-secondary)]">{deal.retail > 0 ? `$${formatMoney(deal.retail)}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-[var(--dp-text-label)] uppercase tracking-wider">
            Est. Profit
            <span className="block normal-case tracking-normal">before tax</span>
          </dt>
          <dd className="mt-0.5"><EstProfit profit={deal.estimatedProfit} expired={expired} /></dd>
        </div>
      </dl>

      <div>
        <div className="text-[12px] text-[var(--dp-text-label)] uppercase tracking-wider">Best Card</div>
        <div className="mt-0.5"><BestCard best={bestCardForDeal(deal, paymentMethods)} expired={expired} inline /></div>
      </div>

      <div className="mt-auto space-y-3 pt-3 border-t border-[color:var(--dp-border)]">
        {!expired && <StoreLinks deal={deal} large />}
        <CardOffers deal={deal} expired={expired} />
      </div>
    </article>
  );
}

// The card's footer: one line per cashout with its payout (when there are
// several) and when it ends, and one Log Purchase button for the product.
function CardOffers({ deal, expired }) {
  const offers = deal.offers || [deal];
  const several = offers.length > 1;
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0 space-y-1.5">
        {offers.map((offer, index) => (
          <div key={`${offer.connectionId}-${offer.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[26px]">
            <CashoutName name={offer.connectionName} />
            {several && (
              <span className={`tabular-nums ${index === 0 ? 'font-semibold text-emerald-400' : 'text-[var(--dp-text-secondary)]'}`}>
                ${formatMoney(offer.payout)}
              </span>
            )}
            <DealExpiry expiresAt={offer.expiresAt} inline />
            {!expired && <OpenOnCashout offer={offer} />}
          </div>
        ))}
      </div>
      {!expired && <span className="flex-shrink-0"><LogPurchaseButton deal={deal} /></span>}
    </div>
  );
}

// Inline (on a card's cashout line) it's one short line, and nothing at all
// when the deal has no end date.
function DealExpiry({ expiresAt, inline = false }) {
  const expiry = formatDealExpiry(expiresAt);
  if (!expiry) return inline ? null : <span className="text-[var(--dp-text-label)]">—</span>;

  const noteTone = expiry.expired ? 'text-rose-400' : expiry.urgent ? 'text-amber-400' : 'text-[var(--dp-text-label)]';
  if (inline) {
    return (
      <span className="text-[12px] text-[var(--dp-text-secondary)] whitespace-nowrap">
        {expiry.date} · <span className={noteTone}>{expiry.note}</span>
      </span>
    );
  }
  return (
    <div>
      <div className="font-semibold text-[var(--dp-text-primary)]">{expiry.date}</div>
      <div className={`text-[12px] ${noteTone}`}>{expiry.note}</div>
    </div>
  );
}

// A round store logo linking straight to the purchase page. Shows the store's
// first letter when there's no known logo or the image doesn't load.
function StoreLink({ link, large }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = logoFailed ? null : storeLogoUrl(link.name);

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.label}
      aria-label={link.label}
      className={`${large ? 'w-10 h-10' : 'w-8 h-8'} rounded-full bg-white border border-[color:var(--dp-border)] flex items-center justify-center overflow-hidden flex-shrink-0 hover:ring-2 hover:ring-[var(--dp-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] transition-shadow`}
    >
      {logo ? (
        <img src={logo} alt="" className={`${large ? 'w-6 h-6' : 'w-5 h-5'} object-contain`} onError={() => setLogoFailed(true)} />
      ) : (
        // Fixed dark text, not a --dp- token: this circle is always bg-white
        // like a real store logo, in both themes, so the letter must stay
        // dark too -- a theme token would turn invisible under dark mode.
        <span className="text-[12px] font-bold text-gray-800">{(link.name || '?').charAt(0).toUpperCase()}</span>
      )}
    </a>
  );
}
