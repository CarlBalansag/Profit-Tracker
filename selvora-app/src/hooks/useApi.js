import { useQuery, useQueryClient } from '@tanstack/react-query';

// All API calls go through Vercel's rewrite proxy (/api/* and /auth/* → Render).
// Using a relative base ('') means requests go to the same origin as the page,
// so the session cookie is always same-origin and never blocked by browsers.
const API = '';

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

// ─── Invalidation helpers (call after mutations to refresh cache) ─────────────
export const useInvalidate = () => {
  const qc = useQueryClient();
  return {
    inventory:      () => qc.invalidateQueries({ queryKey: ['inventory'] }),
    sales:          () => qc.invalidateQueries({ queryKey: ['sales'] }),
    platforms:      () => qc.invalidateQueries({ queryKey: ['platforms'] }),
    dashboard:      () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
    expenses:       () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    paymentMethods: () => qc.invalidateQueries({ queryKey: ['payment-methods'] }),
    creditCard:     () => qc.invalidateQueries({ queryKey: ['creditcard'], exact: false }),
    all:            () => qc.invalidateQueries(),
  };
};
