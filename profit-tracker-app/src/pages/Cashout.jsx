import React, { useState, useMemo, useEffect } from 'react';
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
  Star,
  Table,
  LayoutGrid,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useCashoutProviders,
  useCashoutConnections,
  useCashoutDeals,
  useCashoutMutations,
  useCashoutCommitments,
  usePlatforms,
  usePaymentMethods,
} from '../hooks/useApi';
import { formatMoney } from '../utils/money';
import { displayLabel, statusVisual } from '../data/statusWorkflow';
import { useMatchMedia } from '../hooks/useMatchMedia';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import {
  dealConditionLabels,
  dealLimitLabel,
  dealStoreLinks,
  dealStoreNames,
  estimateDealProfit,
  formatDealExpiry,
  formatDealProfit,
  formatLastSynced,
  isDealExpired,
  matchesRetailCategory,
  parseDealNotes,
  storeLogoUrl,
} from '../utils/cashoutDeals';
import LoadError from '../components/UI/LoadError';

// API keys are managed only in Data Setup.
const DATA_SETUP_STATE = { tab: 'datasetup', view: 'Cashouts' };

// Below this the table no longer fits beside the sidebar -- cards take over
// regardless of the view toggle.
const DEAL_CARDS_QUERY = '(max-width: 1279px)';

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
  const [sortBy, setSortBy] = useState('profit_desc'); // 'profit_desc' | 'payout_desc' | 'ending_soon' | 'updated_desc'
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
    const aggregated = [];
    for (const res of dealsData.results) {
      if (Array.isArray(res.deals)) {
        for (const deal of res.deals) {
          aggregated.push({
            ...deal,
            estimatedProfit: estimateDealProfit(deal),
            connectionId: res.connection?.id,
            connectionName: res.connection?.displayName || res.connection?.provider,
            connectionProvider: res.connection?.provider,
            connectionStatus: res.connection?.status,
            connectionError: res.connection?.lastError,
          });
        }
      }
    }
    return aggregated;
  }, [dealsData]);

  const storeOptions = useMemo(
    () => [...new Set(allDeals.flatMap(dealStoreNames))].sort((a, b) => a.localeCompare(b)),
    [allDeals],
  );
  const expiredCount = useMemo(() => allDeals.filter((deal) => isDealExpired(deal)).length, [allDeals]);

  const [showCommitments, setShowCommitments] = useState(false);
  const { data: commitments = [] } = useCashoutCommitments();
  const activeCommitmentCount = useMemo(() => commitments.filter((c) => c.status === 'active').length, [commitments]);

  // Filter & Sort
  const filteredDeals = useMemo(() => {
    return allDeals.filter((deal) => {
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
    }).sort((a, b) => {
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
      if (sortBy === 'ending_soon') {
        // Deals with no expiration go last.
        const expiresAt = (deal) => (deal.expiresAt ? new Date(deal.expiresAt).getTime() : Infinity);
        return expiresAt(a) === expiresAt(b) ? 0 : expiresAt(a) - expiresAt(b);
      }
      if (sortBy === 'updated_desc') {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      }
      return 0;
    });
  }, [allDeals, selectedProvider, selectedCategory, selectedStore, showExpired, searchTerm, sortBy]);

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

        <div className="flex items-start gap-2.5">
          <div className="flex flex-col items-center gap-1">
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
      <div role="tablist" className="flex items-center gap-1 border-b border-[color:var(--dp-border)]">
        <button
          type="button"
          role="tab"
          aria-selected={!showCommitments}
          onClick={() => setShowCommitments(false)}
          className={`flex items-center gap-2 px-3.5 py-2.5 -mb-px text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
            !showCommitments
              ? 'bg-[var(--dp-card-bg)] border-[color:var(--dp-border)] text-[var(--dp-text-primary)]'
              : 'bg-transparent border-transparent text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'
          }`}
        >
          <Layers size={15} className={!showCommitments ? 'text-[var(--dp-accent)]' : ''} />
          <span>Live Deals</span>
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-[var(--dp-hover-bg)]">
            {allDeals.length - expiredCount}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showCommitments}
          onClick={() => setShowCommitments(true)}
          className={`flex items-center gap-2 px-3.5 py-2.5 -mb-px text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
            showCommitments
              ? 'bg-[var(--dp-card-bg)] border-[color:var(--dp-border)] text-[var(--dp-text-primary)]'
              : 'bg-transparent border-transparent text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'
          }`}
        >
          <span>Commitments</span>
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-[var(--dp-hover-bg)]">{activeCommitmentCount}</span>
        </button>
        {!showCommitments && expiredCount > 0 && (
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

      {/* Empty State when no connections added yet */}
      {!showCommitments && (connectionsLoading ? (
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
                    {c.displayName || c.provider}
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

              {/* Sort Dropdown */}
              <select
                aria-label="Sort deals"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="profit_desc">Highest Profit</option>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {filteredDeals.map((deal) => (
                <DealCard key={`${deal.connectionId}-${deal.id}`} deal={deal} />
              ))}
            </div>
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
                        title="Payout minus retail. Doesn't include sales tax, cashback or coupons."
                      >
                        Est. Profit
                        <span className="block font-normal normal-case tracking-normal">before tax</span>
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
                            <DealSummary deal={deal} />
                          </td>

                          {/* Cashout */}
                          <td className="py-3 px-3">
                            <CashoutName name={deal.connectionName} />
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
function DealSummary({ deal }) {
  const { note, address, deliverTo, coupon } = parseDealNotes(deal.notes);
  const limit = dealLimitLabel(deal);
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
        {limit && (
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
      <div className="text-[12px] text-[var(--dp-text-label)]">{pct}</div>
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

function StoreLinks({ deal, large = false }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${large ? '' : 'min-w-[120px]'}`}>
      {dealStoreLinks(deal).map((link) => (
        <StoreLink key={link.url} link={link} large={large} />
      ))}
    </div>
  );
}

// Pledges already made to a cashout -- read from our own records, since the
// provider itself has no way to tell us which tracking number went with
// which commitment. Deal names come from the current live deals list when
// available; an expired/closed deal still shows its id.
function CommitmentsPanel({ commitments, allDeals }) {
  const { deleteCommitment } = useCashoutMutations();

  if (commitments.length === 0) {
    return (
      <div className="p-6 text-center rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs text-[var(--dp-text-secondary)]">
        No commitments yet. Log Purchase on a deal commits to it.
      </div>
    );
  }

  const withdraw = async (commitment) => {
    if (!confirm('Withdraw this commitment? The cashout frees the quantity back to the deal immediately.')) return;
    try {
      await deleteCommitment.mutateAsync(commitment.id);
      toast.success('Commitment withdrawn.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left border-collapse text-xs">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
            <col className="w-[20%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[color:var(--dp-border)] text-[var(--dp-text-label)] uppercase font-semibold text-[12px] tracking-wider align-top">
              <th className="py-3 px-4">Item</th>
              <th className="py-3 px-3">Cashout</th>
              <th className="py-3 px-3">Bought At</th>
              <th className="py-3 px-3">Committed At</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Tracking</th>
              <th className="py-3 pl-3 pr-6"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--dp-border)]">
            {commitments.map((c) => {
              const deal = allDeals.find((d) => String(d.id) === c.external_deal_id);
              const itemName = c.sale?.inventory?.product_name || deal?.name || `Deal #${c.external_deal_id}`;
              const upc = deal?.items?.[0]?.upcs?.[0];
              const unitCost = c.sale?.inventory?.unit_purchase_cost;
              const unitPayout = c.sale?.unit_price;
              return (
                <tr key={c.id} className={`hover:bg-[var(--dp-hover-bg)] transition-colors ${c.status !== 'active' ? 'opacity-60' : ''}`}>
                  {/* Item */}
                  <td className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      {deal?.imageUrl ? (
                        <img
                          src={deal.imageUrl}
                          alt={itemName}
                          className="w-10 h-10 rounded-lg object-contain bg-white/5 border border-[color:var(--dp-border)] flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] flex items-center justify-center text-[var(--dp-text-label)] flex-shrink-0">
                          <Package size={16} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--dp-text-primary)] truncate" title={itemName}>{itemName}</div>
                        {upc && <div className="text-[12px] text-[var(--dp-text-label)] font-mono truncate">UPC: {upc}</div>}
                        <div className="text-[12px] text-[var(--dp-text-label)] mt-0.5">
                          Qty {c.quantity} · {new Date(c.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Cashout */}
                  <td className="py-3 px-3">
                    <CashoutName name={c.connection?.display_name || c.connection?.provider} />
                  </td>

                  {/* Bought At */}
                  <td className="py-3 px-3 tabular-nums text-[var(--dp-text-secondary)]">
                    {unitCost != null ? `$${formatMoney(unitCost)}` : '—'}
                  </td>

                  {/* Committed At */}
                  <td className="py-3 px-3">
                    <div className="font-semibold tabular-nums text-[var(--dp-text-primary)]">
                      {unitPayout != null ? `$${formatMoney(unitPayout)}` : '—'}
                    </div>
                  </td>

                  {/* Status -- the sale's real workflow status when one exists
                      (the same vocabulary the Statuses page uses), since that
                      already implies "logged" without a separate badge. */}
                  <td className="py-3 px-3">
                    {c.status === 'withdrawn' ? (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[var(--dp-hover-bg)] text-[var(--dp-text-label)]">
                        Withdrawn
                      </span>
                    ) : c.sale?.workflow_status ? (
                      <StatusChip status={c.sale.workflow_status} />
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-400">
                        Committed
                      </span>
                    )}
                  </td>

                  {/* Tracking */}
                  <td className="py-3 px-3">
                    {c.tracking_codes?.length > 0 && (
                      <div className="text-[11px] text-[var(--dp-text-secondary)] font-mono truncate" title={c.tracking_codes.join(', ')}>
                        {c.tracking_codes.join(', ')}
                      </div>
                    )}
                    {c.tracking_error && (
                      <div className="text-[11px] text-rose-400 mt-0.5" title={c.tracking_error}>Tracking failed</div>
                    )}
                    {!c.tracking_codes?.length && !c.tracking_error && <span className="text-[var(--dp-text-label)]">—</span>}
                  </td>

                  {/* Actions */}
                  <td className="py-3 pl-3 pr-6 whitespace-nowrap text-right">
                    {c.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => withdraw(c)}
                        className="px-2.5 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)] transition-colors"
                      >
                        Withdraw
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
      {open && <LogPurchaseModal deal={deal} onClose={() => setOpen(false)} />}
    </>
  );
}

function LogPurchaseModal({ deal, onClose }) {
  const { data: platforms = [] } = usePlatforms();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { logPurchase } = useCashoutMutations();
  const vendors = useMemo(() => platforms.filter((p) => p.type === 'Vendor'), [platforms]);
  const items = deal.items || [];
  const dealStores = useMemo(() => dealStoreNames(deal), [deal]);

  const [itemId, setItemId] = useState(items[0]?.id || '');
  const [quantity, setQuantity] = useState(1);
  const [vendorId, setVendorId] = useState(() => vendors.find((v) => dealStores.includes(v.name))?.id || '');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [unitCost, setUnitCost] = useState(deal.retail || 0);
  const [salesTax, setSalesTax] = useState(0);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [insuredValue, setInsuredValue] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState(null);

  const selectedVendor = vendors.find((v) => v.id === vendorId);
  const selectedPaymentMethod = paymentMethods.find((m) => m.id === paymentMethodId);
  const taxExempt = Boolean(selectedVendor?.tax_exempt_place);
  const cashbackRate = selectedPaymentMethod?.default_cashback_rate || 0;
  const cashbackEarned = Math.round(Number(unitCost) * quantity * (cashbackRate / 100) * 100) / 100;
  const selectedItem = items.find((i) => i.id === itemId);

  const modalRef = useModalKeyboard(true, () => !logPurchase.isPending && onClose());

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!itemId) return setError('Pick which item you bought.');
    if (!vendorId) return setError('Pick the store you bought it from.');
    if (!paymentMethodId) return setError('Pick the card or account you paid with.');
    if (!trackingNumber.trim()) return setError('A tracking number is required -- this is for an item that has already shipped.');

    try {
      const result = await logPurchase.mutateAsync({
        connectionId: deal.connectionId,
        deal_id: deal.id,
        item_id: itemId,
        deal_name: deal.name,
        item_name: selectedItem?.name,
        quantity,
        tracking_codes: [trackingNumber.trim()],
        insured_value: insuredValue ? Number(insuredValue) : undefined,
        store: selectedVendor.name,
        payment_method: selectedPaymentMethod.name,
        unit_cost: Number(unitCost) || 0,
        tax_exempt: taxExempt,
        sales_tax: taxExempt ? 0 : Number(salesTax) || 0,
        cashback_rate: cashbackRate || undefined,
        cashback_earned: cashbackEarned || undefined,
        unit_payout: deal.payout,
        purchase_date: purchaseDate,
      });
      if (result.tracking_submitted) {
        toast.success('Committed and logged -- tracking sent to the cashout.');
      } else {
        toast.success('Committed and logged, but tracking failed to send.', {
          description: result.tracking_error || 'Resubmit it from the Commitments section.',
        });
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        ref={modalRef}
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
          <div>
            <h3 className="font-bold text-base text-[var(--dp-text-primary)]">Log Purchase</h3>
            <p className="text-[11px] text-[var(--dp-text-secondary)] mt-0.5 truncate max-w-xs" title={deal.name}>{deal.name}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>

        <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          This commits to the cashout at today's payout price -- a real, binding pledge -- and submits your tracking number. Only use this once you've actually shipped the item.
        </p>

        {items.length > 1 && (
          <div className="space-y-1.5">
            <label htmlFor="lp-item" className="text-[11px] text-[var(--dp-text-label)]">Which item</label>
            <select id="lp-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className={SELECT_CLASS + ' w-full'}>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="lp-qty" className="text-[11px] text-[var(--dp-text-label)]">Quantity</label>
            <input id="lp-qty" type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] focus:outline-none" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lp-cost" className="text-[11px] text-[var(--dp-text-label)]">Unit cost (what you paid)</label>
            <input id="lp-cost" type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] focus:outline-none" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="lp-store" className="text-[11px] text-[var(--dp-text-label)]">Store</label>
            <select id="lp-store" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={SELECT_CLASS + ' w-full'}>
              <option value="">Select a store…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lp-pay" className="text-[11px] text-[var(--dp-text-label)]">Payment method</label>
            <select id="lp-pay" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className={SELECT_CLASS + ' w-full'}>
              <option value="">Select a card/account…</option>
              {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="lp-tax" className="text-[11px] text-[var(--dp-text-label)]">Sales tax</label>
            {taxExempt ? (
              <p className="text-xs text-[var(--dp-text-secondary)] px-3 py-2">$0.00 (tax-exempt store)</p>
            ) : (
              <input id="lp-tax" type="number" step="0.01" min="0" value={salesTax} onChange={(e) => setSalesTax(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] focus:outline-none" />
            )}
          </div>
          <div className="space-y-1.5">
            <span className="text-[11px] text-[var(--dp-text-label)] block">Cashback</span>
            <p className="text-xs text-[var(--dp-text-secondary)] px-3 py-2">
              {cashbackRate ? `$${cashbackEarned.toFixed(2)} (${cashbackRate}%)` : '—'}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lp-tracking" className="text-[11px] text-[var(--dp-text-label)]">Tracking number</label>
          <input id="lp-tracking" type="text" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="1Z999AA10123456784"
            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lp-insured" className="text-[11px] text-[var(--dp-text-label)]">Insured value (optional, $200–$1,500)</label>
          <input id="lp-insured" type="number" min="200" max="1500" step="0.01" value={insuredValue} onChange={(e) => setInsuredValue(e.target.value)}
            placeholder="Leave blank to skip insurance"
            className="w-full px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none" />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lp-date" className="text-[11px] text-[var(--dp-text-label)]">Purchase date</label>
          <input id="lp-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] focus:outline-none" />
        </div>

        {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-3">
          <button type="button" onClick={onClose} disabled={logPurchase.isPending}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
            Cancel
          </button>
          <button type="submit" disabled={logPurchase.isPending}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-50">
            {logPurchase.isPending && <RefreshCw size={12} className="animate-spin" />}
            {logPurchase.isPending ? 'Committing…' : 'Commit & Log Purchase'}
          </button>
        </div>
      </form>
    </div>
  );
}

function DealCard({ deal }) {
  const expired = isDealExpired(deal);

  return (
    <article className={`p-3.5 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs flex flex-col gap-3 h-full ${expired ? 'opacity-60' : ''}`}>
      <DealSummary deal={deal} />

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

      <div className="mt-auto space-y-2 pt-2 border-t border-[color:var(--dp-border)]">
        <div className="flex items-center gap-3">
          <DealExpiry expiresAt={deal.expiresAt} />
          <CashoutName name={deal.connectionName} />
        </div>
        {expired ? (
          <span className="text-[var(--dp-text-label)]">—</span>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StoreLinks deal={deal} large />
            <LogPurchaseButton deal={deal} />
          </div>
        )}
      </div>
    </article>
  );
}

function DealExpiry({ expiresAt }) {
  const expiry = formatDealExpiry(expiresAt);
  if (!expiry) return <span className="text-[var(--dp-text-label)]">—</span>;

  return (
    <div>
      <div className="font-semibold text-[var(--dp-text-primary)]">{expiry.date}</div>
      <div
        className={`text-[12px] ${
          expiry.expired
            ? 'text-rose-400'
            : expiry.urgent
            ? 'text-amber-400'
            : 'text-[var(--dp-text-label)]'
        }`}
      >
        {expiry.note}
      </div>
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
