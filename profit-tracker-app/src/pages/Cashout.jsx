import React, { useState, useMemo, useEffect } from 'react';
import {
  Coins,
  RefreshCw,
  Plus,
  Search,
  AlertTriangle,
  Clock,
  Trash2,
  KeyRound,
  Layers,
  X,
  Package,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useCashoutProviders,
  useCashoutConnections,
  useCashoutDeals,
  useCashoutHistory,
  useCashoutMutations,
} from '../hooks/useApi';
import { formatMoney } from '../utils/money';
import { dealStoreLinks, estimateDealProfit, formatDealExpiry, storeLogoUrl } from '../utils/cashoutDeals';
import LoadError from '../components/UI/LoadError';

export default function Cashout() {
  const [activeTab, setActiveTab] = useState('deals'); // 'deals' | 'history'
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [sortBy, setSortBy] = useState('payout_desc'); // 'payout_desc' | 'profit_desc' | 'updated_desc'

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
    error: connectionsError,
    refetch: refetchConnections,
  } = useCashoutConnections();

  const {
    data: dealsData,
    error: dealsError,
    refetch: refetchDeals,
    isFetching: dealsFetching,
  } = useCashoutDeals();

  const {
    data: historyData,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useCashoutHistory();

  const {
    deleteConnection,
    testConnection,
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

  // Filter & Sort
  const filteredDeals = useMemo(() => {
    return allDeals.filter((deal) => {
      // Provider filter
      if (selectedProvider !== 'all' && deal.connectionProvider !== selectedProvider) {
        return false;
      }

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
      if (sortBy === 'updated_desc') {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      }
      return 0;
    });
  }, [allDeals, selectedProvider, searchTerm, sortBy]);

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
        await refetchHistory();
        toast.success('Cashout deals synced successfully!', { id: toastId });
      }
    } catch (err) {
      toast.error(err.message || 'Failed to sync cashout connections', { id: toastId });
    }
  };

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

        <div className="flex items-center gap-2.5">
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
      {dealsData?.results?.some((r) => r.isStale || r.connection?.status === 'attention_needed') && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
            <span>
              One or more cashout connections require attention or returned cached data. Check your connections for details.
            </span>
          </div>
          <button
            onClick={() => setShowConnectionsModal(true)}
            className="font-semibold underline hover:text-white"
          >
            Review Connections
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[color:var(--dp-border)] pb-2 text-sm font-medium">
        <button
          onClick={() => setActiveTab('deals')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
            activeTab === 'deals'
              ? 'bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]'
              : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'
          }`}
        >
          <Layers size={15} />
          <span>Live Deals</span>
          <span className="text-xs px-1.5 py-0.2 rounded-full bg-[var(--dp-hover-bg)]">
            {allDeals.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
            activeTab === 'history'
              ? 'bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]'
              : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'
          }`}
        >
          <Clock size={15} />
          <span>Payout History</span>
        </button>
      </div>

      {/* Empty State when no connections added yet */}
      {connections.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-12 text-center max-w-md mx-auto my-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--dp-accent-bg)] flex items-center justify-center text-[var(--dp-accent)]">
            <Coins size={28} />
          </div>
          <h2 className="text-lg font-bold text-[var(--dp-text-primary)]">No cashouts connected</h2>
          <p className="mt-1.5 text-xs text-[var(--dp-text-secondary)]">
            Connect your ElectronicsBuyer (EB) API key to start viewing live cashout deals.
          </p>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            <span>Add Cashout</span>
          </button>
        </div>
      ) : activeTab === 'deals' ? (
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
                <option value="all">All Services</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.provider}>
                    {c.displayName || c.provider}
                  </option>
                ))}
              </select>

              {/* Sort Dropdown */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] focus:outline-none"
              >
                <option value="payout_desc">Highest Payout</option>
                <option value="profit_desc">Highest Profit</option>
                <option value="updated_desc">Recently Added</option>
              </select>
            </div>
          </div>

          {/* Deals Table / Cards */}
          {filteredDeals.length === 0 ? (
            <div className="p-8 text-center rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-xs text-[var(--dp-text-secondary)]">
              No cashout deals matched your search and filters.
            </div>
          ) : (
            <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[color:var(--dp-border)] text-[var(--dp-text-label)] uppercase font-semibold text-[10px] tracking-wider">
                      <th className="py-3 px-4">Deal / Item</th>
                      <th className="py-3 px-3">Service</th>
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
                                <div className="font-semibold text-[var(--dp-text-primary)] truncate">
                                  {deal.name}
                                </div>
                                {deal.items?.[0]?.upcs?.length > 0 && (
                                  <div className="text-[10px] text-[var(--dp-text-label)] font-mono truncate">
                                    UPC: {deal.items[0].upcs[0]}
                                  </div>
                                )}
                                {deal.notes && (
                                  <div className="text-[10px] text-[var(--dp-text-secondary)] line-clamp-1 mt-0.5" title={deal.notes}>
                                    {deal.notes}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Service */}
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
                            {deal.estimatedProfit ? (
                              <div>
                                <div
                                  className={`font-bold ${
                                    deal.estimatedProfit.amount > 0
                                      ? 'text-emerald-400'
                                      : deal.estimatedProfit.amount < 0
                                      ? 'text-rose-400'
                                      : 'text-[var(--dp-text-primary)]'
                                  }`}
                                >
                                  {deal.estimatedProfit.amount < 0 ? '-' : '+'}${formatMoney(Math.abs(deal.estimatedProfit.amount))}
                                </div>
                                <div className="text-[10px] text-[var(--dp-text-label)]">
                                  {deal.estimatedProfit.pct > 0 ? '+' : ''}{deal.estimatedProfit.pct}%
                                </div>
                              </div>
                            ) : (
                              <span className="text-[var(--dp-text-label)]">—</span>
                            )}
                          </td>

                          {/* Expires */}
                          <td className="py-3 px-3 whitespace-nowrap">
                            <DealExpiry expiresAt={deal.expiresAt} />
                          </td>

                          {/* Buy At */}
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-[60px]">
                              {dealStoreLinks(deal).map((link) => (
                                <StoreLink key={link.url} link={link} />
                              ))}
                            </div>
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
      ) : (
        /* Payout History View */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--dp-text-secondary)]">
              {historyData?.trackingSince ? (
                <>Tracking payouts since <strong>{new Date(historyData.trackingSince).toLocaleDateString()}</strong></>
              ) : (
                'Tracking payout history across scheduled syncs'
              )}
            </span>
          </div>

          {historyLoading ? (
            <div className="p-8 text-center text-xs text-[var(--dp-text-secondary)]">Loading payout history…</div>
          ) : !historyData?.snapshots || historyData.snapshots.length === 0 ? (
            <div className="p-8 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-center text-xs text-[var(--dp-text-secondary)]">
              No price change snapshots recorded yet. Snapshots are recorded when payouts or availability change.
            </div>
          ) : (
            <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[color:var(--dp-border)] text-[var(--dp-text-label)] uppercase font-semibold text-[10px] tracking-wider">
                    <th className="py-3 px-4">Captured Time</th>
                    <th className="py-3 px-3">Service</th>
                    <th className="py-3 px-4">Deal / Item</th>
                    <th className="py-3 px-3 text-right">Recorded Payout</th>
                    <th className="py-3 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--dp-border)]">
                  {historyData.snapshots.map((snap) => (
                    <tr key={snap.id} className="hover:bg-[var(--dp-hover-bg)]">
                      <td className="py-3 px-4 text-[var(--dp-text-secondary)]">
                        {new Date(snap.capturedAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-3 font-medium uppercase text-[var(--dp-text-primary)]">
                        {snap.provider}
                      </td>
                      <td className="py-3 px-4 font-semibold text-[var(--dp-text-primary)]">
                        {snap.itemName}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-400">
                        ${formatMoney(snap.payout)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400">
                          {snap.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
                          const t = toast.loading('Testing connection…');
                          try {
                            const res = await testConnection.mutateAsync(conn.id);
                            if (res.success) {
                              toast.success('Connection verified successfully!', { id: t });
                            } else {
                              toast.error(`Verification failed: ${res.message}`, { id: t });
                            }
                          } catch (e) {
                            toast.error(e.message, { id: t });
                          }
                        }}
                        className="px-2.5 py-1 text-xs rounded border border-[color:var(--dp-border)] hover:bg-[var(--dp-hover-bg)] text-[var(--dp-text-secondary)]"
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`Remove cashout connection "${conn.displayName || conn.provider}"?`)) {
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
              <button
                type="button"
                onClick={() => {
                  setShowConnectionsModal(false);
                  setShowAddModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90"
              >
                <Plus size={14} />
                <span>Add Another Cashout</span>
              </button>
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

      {/* Add Cashout Modal */}
      {showAddModal && (
        <AddCashoutModal
          providers={providers}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            refetchConnections();
            refetchDeals();
          }}
        />
      )}

    </div>
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

// ─── Modal: Add Cashout Connection ───────────────────────────────────────────
function AddCashoutModal({ providers, onClose, onSuccess }) {
  const [provider, setProvider] = useState(providers[0]?.id || 'eb');
  const [displayName, setDisplayName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { addConnection } = useCashoutMutations();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('API key is required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await addConnection.mutateAsync({
        provider,
        display_name: displayName.trim() || undefined,
        api_key: apiKey.trim(),
      });
      toast.success('Cashout connected successfully!');
      onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to connect cashout service.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
          <h3 className="font-bold text-base text-[var(--dp-text-primary)]">Add Cashout Connection</h3>
          <button onClick={onClose} className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle size={15} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-[var(--dp-text-secondary)] mb-1">Supported Service</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] focus:outline-none"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-[var(--dp-text-secondary)] mb-1">
              Display Name <span className="text-[var(--dp-text-label)]">(optional)</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. My EB Account"
              className="w-full px-3 py-2 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-medium text-[var(--dp-text-secondary)] mb-1">
              API Key <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your cashout API key"
              autoComplete="off"
              className="w-full px-3 py-2 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] focus:outline-none font-mono"
            />
            <p className="mt-1 text-[10px] text-[var(--dp-text-label)]">
              Your key will be securely encrypted with AES-256-GCM. It is tested with the provider before saving.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-2 rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--dp-accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading && <RefreshCw size={12} className="animate-spin" />}
              <span>{loading ? 'Verifying Key…' : 'Verify & Connect'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
