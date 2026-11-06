import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
    return response;
  });
};

const fetcher = (path) =>
  apiFetch(path).then(r => {
    if (!r.ok) throw new Error(`API error ${r.status}`);
    return r.json();
  });

// ─── Inventory ────────────────────────────────────────────────────────────────
export const useInventory = () =>
  useQuery({
    queryKey: ['inventory'],
    queryFn: () => fetcher('/api/inventory'),
  });

export const useProductNames = () =>
  useQuery({
    queryKey: ['product-names'],
    queryFn: () => fetcher('/api/inventory/product-names'),
    staleTime: 60_000,
  });

export const useRecentTransaction = (productName) =>
  useQuery({
    queryKey: ['recent-transaction', productName],
    queryFn: () => fetcher(`/api/inventory/recent-by-name?product_name=${encodeURIComponent(productName)}`),
    enabled: !!productName,
    staleTime: 0,
  });

// ─── Sales ────────────────────────────────────────────────────────────────────
export const useSales = () =>
  useQuery({
    queryKey: ['sales'],
    queryFn: () => fetcher('/api/sales'),
  });

// ─── Platforms ────────────────────────────────────────────────────────────────
// Platforms rarely change — 30-minute cache is safe. Invalidated on settings save.
export const usePlatforms = () =>
  useQuery({
    queryKey: ['platforms'],
    queryFn: () => fetcher('/api/platforms'),
    staleTime: 1000 * 60 * 30,
  });

// ─── Buyers ───────────────────────────────────────────────────────────────────
// Who a sale was actually paid by/through (a marketplace's buyer, a cashout
// service, or a person) — separate from Platform, which is where it was
// listed/sold. Rarely changes — 30-minute cache is safe.
export const useBuyers = () =>
  useQuery({
    queryKey: ['buyers'],
    queryFn: () => fetcher('/api/buyers'),
    staleTime: 1000 * 60 * 30,
  });

// ─── Payment Methods ──────────────────────────────────────────────────────────
// Payment methods rarely change — 30-minute cache is safe. Invalidated on settings save.
export const usePaymentMethods = () =>
  useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => fetcher('/api/payment-methods'),
    staleTime: 1000 * 60 * 30,
  });

// ─── Dashboard analytics ──────────────────────────────────────────────────────
// Longer staleTime: this is the heaviest endpoint and data doesn't change mid-session
// unless the user explicitly adds a transaction (which calls invalidate.dashboard()).
export const useDashboard = (mode, date) =>
  useQuery({
    queryKey: ['dashboard', mode, date],
    queryFn: () => fetcher(`/api/analytics/dashboard?mode=${mode}&date=${encodeURIComponent(date)}`),
    staleTime: 1000 * 60 * 10, // 10 minutes — overrides the global 5-minute default
  });

// ─── Expenses ─────────────────────────────────────────────────────────────────
export const useExpenses = () =>
  useQuery({
    queryKey: ['expenses'],
    queryFn: () => fetcher('/api/expenses'),
  });

// ─── Credit Card tracker ───────────────────────────────────────────────────────
export const useCreditCard = (month) =>
  useQuery({
    queryKey: ['creditcard', month],
    queryFn: () => fetcher(`/api/creditcard/dashboard${month ? `?month=${month}` : ''}`),
  });

// ─── Goals ────────────────────────────────────────────────────────────────────
export const useGoals = () =>
  useQuery({
    queryKey: ['goals'],
    queryFn: () => fetcher('/api/goals'),
  });

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

// ─── Calendar Events ──────────────────────────────────────────────────────────
export const useCalendarEvents = (month) =>
  useQuery({
    queryKey: ['calendar-events', month],
    queryFn: () => fetcher(`/api/calendar-events?month=${month}`),
    enabled: !!month,
  });

export const useCalendarAutoEvents = (month) =>
  useQuery({
    queryKey: ['calendar-auto-events', month],
    queryFn: () => fetcher(`/api/calendar-events/auto?month=${month}`),
    enabled: !!month,
    staleTime: 1000 * 60 * 5,
  });

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
export const useCashoutProviders = () =>
  useQuery({
    queryKey: ['cashout', 'providers'],
    queryFn: () => fetcher('/api/cashouts/providers'),
    staleTime: 1000 * 60 * 15,
  });

export const useCashoutConnections = () =>
  useQuery({
    queryKey: ['cashout', 'connections'],
    queryFn: () => fetcher('/api/cashouts/connections'),
  });

export const useCashoutDeals = (connectionId = null) =>
  useQuery({
    queryKey: ['cashout', 'deals', connectionId],
    queryFn: () => fetcher(`/api/cashouts/deals${connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ''}`),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

export const useCashoutHistory = ({ dealId = null, provider = null } = {}) =>
  useQuery({
    queryKey: ['cashout', 'history', dealId, provider],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dealId) params.append('dealId', dealId);
      if (provider) params.append('provider', provider);
      const qs = params.toString();
      return fetcher(`/api/cashouts/history${qs ? `?${qs}` : ''}`);
    },
    staleTime: 60_000,
  });

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

  const setMatch = useMutation({
    mutationFn: (data) =>
      apiFetch('/api/cashouts/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to update match');
        }
        return r.json();
      }),
    onSuccess: invalidate,
  });

  const removeMatch = useMutation({
    mutationFn: ({ provider, external_deal_id }) =>
      apiFetch(`/api/cashouts/matches?provider=${encodeURIComponent(provider)}&external_deal_id=${encodeURIComponent(external_deal_id)}`, {
        method: 'DELETE',
      }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to remove match');
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
    setMatch,
    removeMatch,
  };
};
