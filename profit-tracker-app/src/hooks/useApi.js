import { useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { EXPENSES_PAGE_KEY, RECEIPTS_PAGE_KEY } from './usePageCache';
import { toast } from 'sonner';
import { offerPendingCommit, offerTrackingSend } from '../utils/pendingCashoutCommit';

// Leave VITE_API_URL empty in production when Netlify redirects proxy /api and /auth (see netlify.toml).
// Set it locally to the API dev server, e.g. http://localhost:3000.
const API = import.meta.env.VITE_API_URL || '';

// All requests to the API must include X-Requested-With to satisfy the CSRF check.
export const apiFetch = (path, options = {}) => {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    ...options.headers,
  };
  return fetch(`${API}${path}`, { credentials: 'include', ...options, headers }).then(response => {
    if (response.status === 401 && path.startsWith('/api/')) window.dispatchEvent(new Event('auth-expired'));
    if (response.ok && TRACKING_WRITE.test(path) && (options.method === 'PUT' || options.method === 'POST')) {
      offerCashoutCommitIfPending(response);
    }
    if (response.ok && RECORD_DELETE.test(path) && options.method === 'DELETE') {
      warnIfCommitmentStillActive(response);
    }
    return response;
  });
};

// Every screen that adds a tracking number to a sale or a purchase (Statuses,
// Shipping, the transaction editor, status actions) goes through here. When it
// belongs to a cashout purchase logged before it shipped, the response says
// so, and the app shell asks whether to commit it now
// (components/PendingCashoutCommit). For a purchase's tracking it first asks
// whether that package is going straight to the cashout.
const TRACKING_WRITE = /^\/api\/(sales\/[^/?]+(\/actions\/add_outbound_tracking)?|inventory\/[^/?]+(\/transaction|\/actions\/add_tracking)?)$/;
const offerCashoutCommitIfPending = (response) => {
  // Cloned before the caller reads the body; never allowed to break the save.
  if (typeof response.clone !== 'function') return;
  response.clone().json()
    .then((body) => {
      offerPendingCommit(body?.cashout_commit_pending?.commitment_id, body?.cashout_commit_pending?.ask_direct);
      // Already committed, and the cashout doesn't have this number yet.
      offerTrackingSend(body?.cashout_tracking_changed);
    })
    .catch(() => {});
};

// Deleting a purchase or sale doesn't withdraw its cashout commitment; the
// response says so when one is still active.
const RECORD_DELETE = /^\/api\/(sales|inventory)\/[^/?]+$/;
const warnIfCommitmentStillActive = (response) => {
  if (typeof response.clone !== 'function') return;
  response.clone().json()
    .then((body) => { if (body?.cashout_warning) toast.warning(body.cashout_warning, { duration: 10000 }); })
    .catch(() => {});
};

const fetcher = (path) =>
  apiFetch(path).then(r => {
    if (!r.ok) throw new Error(`API error ${r.status}`);
    return r.json();
  });

// Several hooks below are thin wrappers over an exported `...Query()`
// definition, so hover prefetching (data/pagePrefetch.js) warms exactly the
// cache entries the pages read.

// ─── Inventory ────────────────────────────────────────────────────────────────
export const inventoryQuery = () => ({
  queryKey: ['inventory'],
  queryFn: () => fetcher('/api/inventory'),
});
export const useInventory = () => useQuery(inventoryQuery());

export const productNamesQuery = () => ({
  queryKey: ['product-names'],
  queryFn: () => fetcher('/api/inventory/product-names'),
  staleTime: 60_000,
});
export const useProductNames = () => useQuery(productNamesQuery());

export const useRecentTransaction = (productName) =>
  useQuery({
    queryKey: ['recent-transaction', productName],
    queryFn: () => fetcher(`/api/inventory/recent-by-name?product_name=${encodeURIComponent(productName)}`),
    enabled: !!productName,
    staleTime: 0,
  });

// ─── Sales ────────────────────────────────────────────────────────────────────
export const salesQuery = () => ({
  queryKey: ['sales'],
  queryFn: () => fetcher('/api/sales'),
});
export const useSales = () => useQuery(salesQuery());

// ─── Platforms ────────────────────────────────────────────────────────────────
// Platforms rarely change — 30-minute cache is safe. Invalidated on settings save.
export const platformsQuery = () => ({
  queryKey: ['platforms'],
  queryFn: () => fetcher('/api/platforms'),
  staleTime: 1000 * 60 * 30,
});
export const usePlatforms = () => useQuery(platformsQuery());

// ─── Buyers ───────────────────────────────────────────────────────────────────
// Who a sale was actually paid by/through (a marketplace's buyer, a cashout
// service, or a person) — separate from Platform, which is where it was
// listed/sold. Rarely changes — 30-minute cache is safe.
export const buyersQuery = () => ({
  queryKey: ['buyers'],
  queryFn: () => fetcher('/api/buyers'),
  staleTime: 1000 * 60 * 30,
});
export const useBuyers = () => useQuery(buyersQuery());

// ─── Payment Methods ──────────────────────────────────────────────────────────
// Payment methods rarely change — 30-minute cache is safe. Invalidated on settings save.
export const paymentMethodsQuery = () => ({
  queryKey: ['payment-methods'],
  queryFn: () => fetcher('/api/payment-methods'),
  staleTime: 1000 * 60 * 30,
});
export const usePaymentMethods = () => useQuery(paymentMethodsQuery());

// ─── Data reset ───────────────────────────────────────────────────────────────
export const useDataReset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scope) => {
      const response = await apiFetch('/api/data-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, confirmation: 'RESET' }),
      });
      if (!response.ok) {
        const error = new Error('Data reset failed');
        // The server answered, so its transaction rolled back. A dropped
        // connection has no response, and then the outcome is unknown.
        error.rolledBack = true;
        throw error;
      }
      return response.json();
    },
    onSuccess: async () => {
      // This form draft can name a vendor or card that no longer exists.
      localStorage.removeItem('add_transaction_draft');
      await qc.cancelQueries();
      await qc.resetQueries();
    },
  });
};

// ─── Dashboard analytics ──────────────────────────────────────────────────────
// Longer staleTime: this is the heaviest endpoint and data doesn't change mid-session
// unless the user explicitly adds a transaction (which calls invalidate.dashboard()).
export const dashboardQuery = (mode, date) => ({
  queryKey: ['dashboard', mode, date],
  queryFn: () => fetcher(`/api/analytics/dashboard?mode=${mode}&date=${encodeURIComponent(date)}`),
  staleTime: 1000 * 60 * 10, // 10 minutes — overrides the global 5-minute default
});
export const useDashboard = (mode, date) =>
  useQuery({
    ...dashboardQuery(mode, date),
    // Switching All/Cashout/Marketplace or the date range keeps the last numbers
    // on screen (as isPlaceholderData) until the new ones arrive, instead of
    // blanking the whole page.
    placeholderData: keepPreviousData,
  });

// Cash Flow page. Keyed under 'dashboard' so every mutation that refreshes
// the Dashboard numbers refreshes these too.
export const cashFlowQuery = () => ({
  queryKey: ['dashboard', 'cashflow'],
  queryFn: () => fetcher('/api/analytics/cashflow'),
  staleTime: 1000 * 60 * 10,
});
export const useCashFlow = () => useQuery(cashFlowQuery());

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const useExpenses = () =>
  useQuery({
    queryKey: ['expenses'],
    queryFn: () => fetcher('/api/expenses'),
  });

// Everything the Expenses page shows, as one cache entry, so a revisit (or a
// hover prefetch) shows it at once while it refreshes. Keyed under 'expenses'
// so invalidate.expenses() marks it stale too. Fails if expenses or recurring
// fail; the derived lines are optional (derivedFailed says they're missing).
export const expensesPageQuery = () => ({
  queryKey: EXPENSES_PAGE_KEY,
  queryFn: async () => {
    const [expenses, recurring, derived] = await Promise.all([
      fetcher('/api/expenses'),
      fetcher('/api/recurring-expenses'),
      fetcher('/api/expenses/derived').catch(() => null),
    ]);
    return {
      expenses,
      recurring,
      derived: Array.isArray(derived) ? derived : [],
      derivedFailed: !Array.isArray(derived),
    };
  },
  staleTime: 10_000,
});

// ─── Receipts ─────────────────────────────────────────────────────────────────
export const receiptsPageQuery = () => ({
  queryKey: RECEIPTS_PAGE_KEY,
  queryFn: async () => {
    const data = await fetcher('/api/receipts');
    return { withReceipts: data.withReceipts || [], withoutReceipts: data.withoutReceipts || [] };
  },
  staleTime: 10_000,
});

// ─── Credit Card tracker ───────────────────────────────────────────────────────
export const creditCardQuery = (month) => ({
  queryKey: ['creditcard', month],
  queryFn: () => fetcher(`/api/creditcard/dashboard${month ? `?month=${month}` : ''}`),
});
export const useCreditCard = (month) => useQuery(creditCardQuery(month));

// ─── Goals ────────────────────────────────────────────────────────────────────
export const goalsQuery = () => ({
  queryKey: ['goals'],
  queryFn: () => fetcher('/api/goals'),
});
export const useGoals = () => useQuery(goalsQuery());

export const useGoalsMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['goals'] });

  const create = useMutation({
    mutationFn: (data) => apiFetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Failed'); }); return r.json(); }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }) => apiFetch(`/api/goals/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Failed'); }); return r.json(); }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id) => apiFetch(`/api/goals/${id}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: invalidate,
  });

  return { create, update, remove };
};

// ─── Product Notes ────────────────────────────────────────────────────────────
export const useProductNote = (productName) => {
  const key = productName?.trim().toLowerCase();
  return useQuery({
    queryKey: ['product-note', key],
    queryFn: () => fetcher(`/api/product-notes?product_name=${encodeURIComponent(key)}`),
    enabled: !!key,
  });
};

export const useProductNoteMutations = (productName) => {
  const qc = useQueryClient();
  const key = productName?.trim().toLowerCase();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['product-note', key] });

  const upsert = useMutation({
    mutationFn: ({ note }) => apiFetch('/api/product-notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_name: key, note }),
    }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Failed'); }); return r.json(); }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/product-notes?product_name=${encodeURIComponent(key)}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: invalidate,
  });

  return { upsert, remove };
};

// ─── Transaction Notes ────────────────────────────────────────────────────────
// Per-sale / per-purchase notes. entityType is 'sale' or 'purchase'.
const noteJson = (r) => {
  if (!r.ok) return r.json().catch(() => ({})).then(e => { throw new Error(e.error || 'Failed'); });
  return r.json();
};

export const useTransactionNotes = (entityType, entityId) =>
  useQuery({
    queryKey: ['transaction-notes', entityType, entityId],
    queryFn: () => fetcher(`/api/transaction-notes?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`),
    enabled: !!entityType && !!entityId,
  });

export const useTransactionNoteMutations = (entityType, entityId) => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['transaction-notes', entityType, entityId] });

  const add = useMutation({
    mutationFn: ({ body, pinned }) => apiFetch('/api/transaction-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_type: entityType, entity_id: entityId, body, ...(pinned !== undefined && { pinned }) }),
    }).then(noteJson),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }) => apiFetch(`/api/transaction-notes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(noteJson),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id) => apiFetch(`/api/transaction-notes/${id}`, { method: 'DELETE' }).then(noteJson),
    onSuccess: invalidate,
  });

  return { add, update, remove };
};

// ─── Refunds ──────────────────────────────────────────────────────────────────
// kind: 'purchase' (money back from the store) or 'sale' (money back to a buyer).
const refundParam = (kind) => (kind === 'sale' ? 'sale_id' : 'inventory_id');

export const useRefunds = (kind, id) =>
  useQuery({
    queryKey: ['refunds', kind, id],
    queryFn: () => fetcher(`/api/refunds?${refundParam(kind)}=${encodeURIComponent(id)}`),
    enabled: !!kind && !!id,
  });

export const useRefundMutations = (kind, id) => {
  const qc = useQueryClient();
  // A refund changes cost, revenue, stock and card totals on every screen.
  const invalidate = () => qc.invalidateQueries();

  const add = useMutation({
    mutationFn: ({ amount, quantity, date, note }) => apiFetch('/api/refunds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [refundParam(kind)]: id, amount, quantity, date, note }),
    }).then(noteJson),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (refundId) => apiFetch(`/api/refunds/${refundId}`, { method: 'DELETE' }).then(noteJson),
    onSuccess: invalidate,
  });

  return { add, remove };
};

// ─── Activity (log + Undo) ───────────────────────────────────────────────────
// Newest first, 50 at a time. Undo itself lives in utils/undoToast.js; every
// undo invalidates all queries, which refreshes this list too.
export const useActivity = () =>
  useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) => fetcher(`/api/activity?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: null,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });

// ─── Calendar Events ──────────────────────────────────────────────────────────
export const calendarEventsQuery = (month) => ({
  queryKey: ['calendar-events', month],
  queryFn: () => fetcher(`/api/calendar-events?month=${month}`),
});
export const useCalendarEvents = (month) =>
  useQuery({ ...calendarEventsQuery(month), enabled: !!month });

export const calendarAutoEventsQuery = (month) => ({
  queryKey: ['calendar-auto-events', month],
  queryFn: () => fetcher(`/api/calendar-events/auto?month=${month}`),
  staleTime: 1000 * 60 * 5,
});
export const useCalendarAutoEvents = (month) =>
  useQuery({ ...calendarAutoEventsQuery(month), enabled: !!month });

export const useCalendarToken = () =>
  useQuery({
    queryKey: ['calendar-token'],
    queryFn: () => apiFetch('/api/calendar-events/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    staleTime: Infinity, // token doesn't change
  });

export const useCalendarMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['calendar-events'] });

  const create = useMutation({
    mutationFn: (data) => apiFetch('/api/calendar-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Failed'); }); return r.json(); }),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }) => apiFetch(`/api/calendar-events/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Failed'); }); return r.json(); }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id) => apiFetch(`/api/calendar-events/${id}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: invalidate,
  });

  return { create, update, remove };
};

// ─── Invalidation helpers (call after mutations to refresh cache) ─────────────
export const useInvalidate = () => {
  const qc = useQueryClient();
  return {
    inventory:       () => qc.invalidateQueries({ queryKey: ['inventory'] }),
    sales:           () => qc.invalidateQueries({ queryKey: ['sales'] }),
    platforms:       () => qc.invalidateQueries({ queryKey: ['platforms'] }),
    buyers:          () => qc.invalidateQueries({ queryKey: ['buyers'] }),
    dashboard:       () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
    expenses:        () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    paymentMethods:  () => qc.invalidateQueries({ queryKey: ['payment-methods'] }),
    creditCard:      () => qc.invalidateQueries({ queryKey: ['creditcard'], exact: false }),
    productNote:     (name) => qc.invalidateQueries({ queryKey: ['product-note', name?.trim().toLowerCase()] }),
    calendarEvents:  () => qc.invalidateQueries({ queryKey: ['calendar-events'] }),
    apiKeys:         () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
    cashouts:        () => qc.invalidateQueries({ queryKey: ['cashout'] }),
    all:             () => qc.invalidateQueries(),
  };
};

// ─── Cashouts ────────────────────────────────────────────────────────────────
export const cashoutProvidersQuery = () => ({
  queryKey: ['cashout', 'providers'],
  queryFn: () => fetcher('/api/cashouts/providers'),
  staleTime: 1000 * 60 * 15,
});
export const useCashoutProviders = () => useQuery(cashoutProvidersQuery());

export const cashoutConnectionsQuery = () => ({
  queryKey: ['cashout', 'connections'],
  queryFn: () => fetcher('/api/cashouts/connections'),
});
export const useCashoutConnections = () => useQuery(cashoutConnectionsQuery());

export const cashoutDealsQuery = (connectionId = null) => ({
  queryKey: ['cashout', 'deals', connectionId],
  queryFn: () => fetcher(`/api/cashouts/deals${connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ''}`),
});
export const useCashoutDeals = (connectionId = null) =>
  useQuery({
    ...cashoutDealsQuery(connectionId),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

export const cashoutCommitmentsQuery = () => ({
  queryKey: ['cashout', 'commitments'],
  queryFn: () => fetcher('/api/cashouts/commitments'),
});
export const useCashoutCommitments = () => useQuery(cashoutCommitmentsQuery());

export const useCashoutMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['cashout'] });

  const addConnection = useMutation({
    mutationFn: (data) =>
      apiFetch('/api/cashouts/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to add connection');
        }
        return r.json();
      }),
    onSuccess: invalidate,
  });

  const updateConnection = useMutation({
    mutationFn: ({ id, ...data }) =>
      apiFetch(`/api/cashouts/connections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to update connection');
        }
        return r.json();
      }),
    onSuccess: invalidate,
  });

  const deleteConnection = useMutation({
    mutationFn: (id) =>
      apiFetch(`/api/cashouts/connections/${id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to delete connection');
        }
        return r.json();
      }),
    onSuccess: invalidate,
  });

  const testConnection = useMutation({
    mutationFn: (id) =>
      apiFetch(`/api/cashouts/connections/${id}/test`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to test connection');
        }
        return r.json();
      }),
    onSuccess: invalidate,
  });

  const syncConnection = useMutation({
    mutationFn: (id) =>
      apiFetch(`/api/cashouts/connections/${id}/sync`, { method: 'POST' }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          const err = new Error(e.error || 'Failed to sync connection');
          err.cooldown = e.cooldown;
          err.remainingSeconds = e.remainingSeconds;
          throw err;
        }
        return r.json();
      }),
    onSuccess: invalidate,
  });

  const logPurchase = useMutation({
    mutationFn: ({ connectionId, ...data }) =>
      apiFetch(`/api/cashouts/connections/${connectionId}/log-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = new Error(body.error || 'Failed to log this purchase');
          err.code = body.code;
          throw err;
        }
        return body;
      }),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
    },
  });

  const deleteCommitment = useMutation({
    mutationFn: (id) =>
      apiFetch(`/api/cashouts/commitments/${id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to withdraw this commitment');
        }
        return r.json();
      }),
    onSuccess: invalidate,
  });

  return {
    addConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    syncConnection,
    logPurchase,
    deleteCommitment,
  };
};
