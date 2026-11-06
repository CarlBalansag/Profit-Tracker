import React, { useState, useMemo, useEffect } from 'react';
import {
  Check,
  Coins,
  Copy,
  RefreshCw,
  Plus,
  Search,
  AlertTriangle,
  Trash2,
  KeyRound,
  Layers,
  X,
  Package,
  Star,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useCashoutProviders,
  useCashoutConnections,
  useCashoutDeals,
  useCashoutMutations,
} from '../hooks/useApi';
import { formatMoney } from '../utils/money';
import { useMatchMedia } from '../hooks/useMatchMedia';
import {
  dealConditionLabels,
  dealLimitLabel,
  dealStoreLinks,
  dealStoreNames,
  estimateDealProfit,
  formatDealExpiry,
  formatLastSynced,
  isDealExpired,
  matchesRetailCategory,
  parseDealNotes,
  storeLogoUrl,
} from '../utils/cashoutDeals';
import LoadError from '../components/UI/LoadError';

// API keys are managed only in Data Setup.
const DATA_SETUP_STATE = { tab: 'datasetup', view: 'Cashouts' };

export default function Cashout() {
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all'); // 'all' | 'above_retail' | 'close_to_retail'
  const [selectedStore, setSelectedStore] = useState('all');
  const [showExpired, setShowExpired] = useState(false);
  const [sortBy, setSortBy] = useState('profit_desc'); // 'profit_desc' | 'payout_desc' | 'ending_soon' | 'updated_desc'
  const isPhone = useMatchMedia('(max-width: 767px)');

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

  const {
    deleteConnection,
    syncConnection,
  } = useCashoutMutations();

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
            <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-[var(--dp-accent-bg)] text-[var(--dp-accent)] border border-[color:var(--dp-accent)]/20">
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
              <span className="text-[10px] text-[var(--dp-text-label)] whitespace-nowrap">
                Last synced {lastSynced}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowConnectionsModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 transition-opacity shadow-sm"
          >
            <KeyRound size={14} />
            <span>Manage Connections</span>
            {connections.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-black/25 text-[10px]">
                {connections.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Connection Stale / Attention Needed Warning Banner */}
      {troubledResult && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
            <span>{troubleMessage}</span>
          </div>
          <button
            onClick={() => setShowConnectionsModal(true)}
            className="font-semibold underline hover:text-white"
          >
            Review Connections
          </button>
        </div>
      )}

      {/* Deal Count */}
      <div className="flex items-center gap-2 border-b border-[color:var(--dp-border)] pb-2 text-sm font-medium text-[var(--dp-text-primary)]">
        <Layers size={15} className="text-[var(--dp-accent)]" />
        <span>Live Deals</span>
        <span className="text-xs px-1.5 py-0.2 rounded-full bg-[var(--dp-hover-bg)]">
          {allDeals.length - expiredCount}
        </span>
        {expiredCount > 0 && (
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

      {/* Empty State when no connections added yet */}
      {connectionsLoading ? (
        <div className="p-8 text-center text-xs text-[var(--dp-text-secondary)]">Loading cashout deals…</div>
      ) : connections.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-12 text-center max-w-md mx-auto my-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--dp-accent-bg)] flex items-center justify-center text-[var(--dp-accent)]">
            <Coins size={28} />
          </div>
          <h2 className="text-lg font-bold text-[var(--dp-text-primary)]">No cashouts connected</h2>
          <p className="mt-1.5 text-xs text-[var(--dp-text-secondary)]">
            Connect your ElectronicsBuyer (EB) API key to start viewing live cashout deals.
          </p>
          <Link
            to="/settings"
            state={DATA_SETUP_STATE}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            <span>Add Cashout</span>
          </Link>
        </div>
      ) : (
        <>
          {/* Search, Filter & Controls */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dp-text-label)]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search deals, UPCs, items…"
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none focus:border-[var(--dp-accent)]"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Provider Filter */}
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] focus:outline-none"
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
                className="px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] focus:outline-none"
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
                className="px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] focus:outline-none"
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
                className="px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] focus:outline-none"
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
          ) : isPhone ? (
            <div className="space-y-3">
              {filteredDeals.map((deal) => (
                <DealCard key={`${deal.connectionId}-${deal.id}`} deal={deal} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[color:var(--dp-border)] text-[var(--dp-text-label)] uppercase font-semibold text-[10px] tracking-wider">
                      <th className="py-3 px-4">Deal / Item</th>
                      <th className="py-3 px-3">Cashout</th>
                      <th className="py-3 px-3 text-right">Payout</th>
                      <th className="py-3 px-3 text-right">Retail</th>
                      <th
                        className="py-3 px-3 text-right"
                        title="Payout minus retail. Doesn't include sales tax, cashback or coupons."
                      >
                        Est. Profit
                      </th>
                      <th className="py-3 px-3">Expires</th>
                      <th className="py-3 px-3">Buy At</th>
                      <th className="py-3 px-3"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--dp-border)]">
                    {filteredDeals.map((deal) => {
                      return (
                        <tr
                          key={`${deal.connectionId}-${deal.id}`}
                          className="hover:bg-[var(--dp-hover-bg)] transition-colors"
                        >
                          {/* Deal Info */}
                          <td className="py-3 px-4 max-w-xs">
                            <DealSummary deal={deal} />
                          </td>

                          {/* Cashout */}
                          <td className="py-3 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--dp-hover-bg)] text-[var(--dp-text-primary)] border border-[color:var(--dp-border)]">
                              {deal.connectionName}
                            </span>
                          </td>

                          {/* Payout */}
                          <td className="py-3 px-3 text-right">
                            <div className="font-semibold text-[var(--dp-text-primary)]">
                              ${formatMoney(deal.payout)}
                            </div>
                          </td>

                          {/* Retail */}
                          <td className="py-3 px-3 text-right text-[var(--dp-text-secondary)]">
                            {deal.retail > 0 ? `$${formatMoney(deal.retail)}` : '—'}
                          </td>

                          {/* Est. Profit */}
                          <td className="py-3 px-3 text-right">
                            <EstProfit profit={deal.estimatedProfit} />
                          </td>

                          {/* Expires */}
                          <td className="py-3 px-3 whitespace-nowrap">
                            <DealExpiry expiresAt={deal.expiresAt} />
                          </td>

                          {/* Buy At */}
                          <td className="py-3 px-3">
                            <StoreLinks deal={deal} />
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-right">
                            <LogPurchaseButton />
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
      )}

      {/* Connection Management Modal */}
      {showConnectionsModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
              <div className="flex items-center gap-2">
                <KeyRound size={18} className="text-[var(--dp-accent)]" />
                <h3 className="font-bold text-base text-[var(--dp-text-primary)]">
                  Connected Cashout Services
                </h3>
              </div>
              <button
                onClick={() => setShowConnectionsModal(false)}
                className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto">
              {connections.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--dp-text-secondary)]">
                  No cashout connections configured.
                </div>
              ) : (
                connections.map((conn) => (
                  <div
                    key={conn.id}
                    className="p-3.5 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-bg)] flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[var(--dp-text-primary)]">
                          {conn.displayName || conn.providerName || conn.provider}
                        </span>
                        {conn.status === 'active' ? (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">
                            Active
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400">
                            Attention Needed
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--dp-text-label)] mt-0.5">
                        Key: ••••••••••••{conn.keyLast4} • Synced:{' '}
                        {conn.lastSyncedAt ? new Date(conn.lastSyncedAt).toLocaleTimeString() : 'Never'}
                      </div>
                      {conn.lastError && (
                        <div className="text-[10px] text-rose-400 mt-1 max-w-xs truncate" title={conn.lastError}>
                          Error: {conn.lastError}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`Remove cashout connection "${conn.displayName || conn.provider}"? Its saved payout records will be deleted.`)) {
                            try {
                              await deleteConnection.mutateAsync(conn.id);
                              toast.success('Connection removed.');
                            } catch (e) {
                              toast.error(e.message);
                            }
                          }
                        }}
                        className="p-1.5 rounded text-rose-400 hover:bg-rose-500/10"
                        title="Delete connection"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-[color:var(--dp-border)] pt-3">
              <Link
                to="/settings"
                state={DATA_SETUP_STATE}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90"
              >
                <Plus size={14} />
                <span>Add Cashout</span>
              </Link>
              <button
                type="button"
                onClick={() => setShowConnectionsModal(false)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Name, image, UPC, note and tags: the same on the table and the phone cards.
function DealSummary({ deal }) {
  const { note, address, deliverTo } = parseDealNotes(deal.notes);
  const limit = dealLimitLabel(deal);
  const conditions = dealConditionLabels(deal);
  const upc = deal.items?.[0]?.upcs?.[0];

  return (
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
          <div className="text-[10px] text-[var(--dp-text-label)] font-mono truncate">UPC: {upc}</div>
        )}
        {note && (
          <div className="text-[10px] text-[var(--dp-text-secondary)] line-clamp-1 mt-0.5" title={note}>
            {note}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1 mt-1">
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
          {address && <CopyAddressButton address={address} />}
        </div>
      </div>
    </div>
  );
}

function DealTag({ className, title, children }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

function CopyAddressButton({ address }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success('Address copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the address");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={address}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy Address'}
    </button>
  );
}

function EstProfit({ profit }) {
  if (!profit) return <span className="text-[var(--dp-text-label)]">—</span>;

  return (
    <div>
      <div
        className={`font-bold ${
          profit.amount > 0
            ? 'text-emerald-400'
            : profit.amount < 0
            ? 'text-rose-400'
            : 'text-[var(--dp-text-primary)]'
        }`}
      >
        {profit.amount < 0 ? '-' : '+'}${formatMoney(Math.abs(profit.amount))}
      </div>
      <div className="text-[10px] text-[var(--dp-text-label)]">
        {profit.pct > 0 ? '+' : ''}{profit.pct}%
      </div>
    </div>
  );
}

function StoreLinks({ deal }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-[60px]">
      {dealStoreLinks(deal).map((link) => (
        <StoreLink key={link.url} link={link} />
      ))}
    </div>
  );
}

// Placeholder: it will open a short form that records the purchase and its sale
// to the cashout. It saves nothing until that's built.
function LogPurchaseButton({ fullWidth = false }) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg whitespace-nowrap bg-[var(--dp-accent)] text-white opacity-50 cursor-not-allowed ${fullWidth ? 'w-full' : ''}`}
    >
      Log Purchase
    </button>
  );
}

function DealCard({ deal }) {
  return (
    <article className="p-3.5 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs space-y-3">
      <DealSummary deal={deal} />

      <dl className="grid grid-cols-3 gap-2">
        <div>
          <dt className="text-[10px] text-[var(--dp-text-label)] uppercase tracking-wider">Payout</dt>
          <dd className="mt-0.5 font-semibold text-[var(--dp-text-primary)]">${formatMoney(deal.payout)}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-[var(--dp-text-label)] uppercase tracking-wider">Retail</dt>
          <dd className="mt-0.5 text-[var(--dp-text-secondary)]">{deal.retail > 0 ? `$${formatMoney(deal.retail)}` : '—'}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-[var(--dp-text-label)] uppercase tracking-wider">Est. Profit</dt>
          <dd className="mt-0.5"><EstProfit profit={deal.estimatedProfit} /></dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[color:var(--dp-border)]">
        <DealExpiry expiresAt={deal.expiresAt} />
        <StoreLinks deal={deal} />
      </div>

      <LogPurchaseButton fullWidth />
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
        className={`text-[10px] ${
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
function StoreLink({ link }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = logoFailed ? null : storeLogoUrl(link.name);

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.label}
      aria-label={link.label}
      className="w-7 h-7 rounded-full bg-white border border-[color:var(--dp-border)] flex items-center justify-center overflow-hidden flex-shrink-0 hover:ring-2 hover:ring-[var(--dp-accent)] transition-shadow"
    >
      {logo ? (
        <img src={logo} alt="" className="w-4 h-4 object-contain" onError={() => setLogoFailed(true)} />
      ) : (
        <span className="text-[11px] font-bold text-gray-800">{(link.name || '?').charAt(0).toUpperCase()}</span>
      )}
    </a>
  );
}
