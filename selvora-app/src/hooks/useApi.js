import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Leave VITE_API_URL empty in production when Vercel rewrites proxy /api and /auth.
// Set it locally to the API dev server, e.g. http://localhost:3000.
const API = import.meta.env.VITE_API_URL || '';

// All requests to the API must include X-Requested-With to satisfy the CSRF check.
export const apiFetch = (path, options = {}) => {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    ...options.headers,
  };
  return fetch(`${API}${path}`, { credentials: 'include', ...options, headers });
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
    dashboard:       () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
    expenses:        () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    paymentMethods:  () => qc.invalidateQueries({ queryKey: ['payment-methods'] }),
    creditCard:      () => qc.invalidateQueries({ queryKey: ['creditcard'], exact: false }),
    productNote:     (name) => qc.invalidateQueries({ queryKey: ['product-note', name?.trim().toLowerCase()] }),
    calendarEvents:  () => qc.invalidateQueries({ queryKey: ['calendar-events'] }),
    all:             () => qc.invalidateQueries(),
  };
};
