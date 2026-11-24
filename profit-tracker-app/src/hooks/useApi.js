import { useEffect } from 'react';
import { QueryClient, useQuery, useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { EXPENSES_PAGE_KEY, RECEIPTS_PAGE_KEY, useOptionalQueryClient } from './usePageCache';
import { toast } from 'sonner';
import { offerPendingCommit, offerTrackingSend, offerCommitLower } from '../utils/pendingCashoutCommit';
import { localToday } from '../utils/returnWindow';

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
    if (response.ok && SALE_UNSHIPPED.test(path)) {
      offerCommitLowerIfCommitted(response);
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

// A committed sale that was cancelled, voided or returned: the response says
// so, and the app shell asks whether to take it off the cashout commitment.
const SALE_UNSHIPPED = /^\/api\/sales\/[^/?]+\/actions\/(cancel_sale|void_sale|mark_returned)$/;
const offerCommitLowerIfCommitted = (response) => {
  if (typeof response.clone !== 'function') return;
  response.clone().json()
    .then((body) => offerCommitLower(body?.cashout_commit_lower))
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
// group: undefined (everything), 'records' (buys, sales, expenses) or 'setup'.
// source 'email': only the email sync's automatic changes (Automation page).
// review (email automation): 'open' = still to confirm, 'done' = confirmed,
// rejected or undone.
export const useActivity = (group, source, review) =>
  useInfiniteQuery({
    queryKey: ['activity', group ?? 'all', ...(source ? [source] : []), ...(review ? [review] : [])],
    queryFn: ({ pageParam }) => fetcher(`/api/activity?limit=50${group ? `&group=${group}` : ''}${source ? `&source=${source}` : ''}${review ? `&review=${review}` : ''}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: null,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });

// ─── To-Do ────────────────────────────────────────────────────────────────────
// Worked out from the records on every read (api services/todos.js), with the
// device's own date so "due tomorrow" means the user's tomorrow. Shared by the
// To-Do page, the sidebar badge and the Dashboard card.
export const todosQuery = () => ({
  queryKey: ['todos'],
  queryFn: () => fetcher(`/api/todos?today=${localToday()}`),
  // Always refetched when the page (or the Dashboard card) opens, so a record
  // fixed on another page has already dropped off the list.
  staleTime: 0,
  refetchInterval: 1000 * 60 * 5,
});
export const useTodos = () => useQuery(todosQuery());

// The open to-do count for the nav badges. The sidebar and bottom bar also
// render without a QueryClientProvider (their unit tests), where this is 0.
let inertClient = null;
export function useTodoCount() {
  const client = useOptionalQueryClient();
  inertClient ??= client ? null : new QueryClient();
  const { data } = useQuery({ ...todosQuery(), enabled: Boolean(client) }, client || inertClient);
  const count = data?.counts?.total || 0;
  // The number on the installed app's icon (phones and desktops that support it).
  useEffect(() => {
    if (!data || typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
  }, [data, count]);
  return count;
}

// Snooze / dismiss / mark done one item, or (action 'restore') undo that.
export const saveTodoState = async ({ key, action, until }) => {
  const response = action === 'restore'
    ? await apiFetch(`/api/todos/state?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    : await apiFetch('/api/todos/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, action, ...(until ? { until } : {}), today: localToday() }),
    });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `API error ${response.status}`);
  return body;
};

export const useTodoState = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveTodoState,
    // Hide (or bring back) the item right away; a failure puts the list back.
    onMutate: async ({ key, action }) => {
      await qc.cancelQueries({ queryKey: ['todos'] });
      const previous = qc.getQueryData(['todos']);
      if (previous && action !== 'restore') {
        const items = previous.items.filter((entry) => entry.key !== key);
        qc.setQueryData(['todos'], { ...previous, items, counts: countTodos(items), hidden: (previous.hidden || 0) + 1 });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['todos'], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });
};

export function countTodos(items) {
  const counts = { total: items.length, urgent: 0 };
  for (const entry of items) {
    if (entry.urgency === 'overdue' || entry.urgency === 'today') counts.urgent += 1;
    counts[entry.group] = (counts[entry.group] || 0) + 1;
  }
  return counts;
}

// ─── Reminders ────────────────────────────────────────────────────────────────
export const remindersQuery = (status = 'open') => ({
  queryKey: ['reminders', status],
  queryFn: () => fetcher(`/api/reminders?status=${status}`),
});
export const useReminders = (status = 'open') => useQuery(remindersQuery(status));

async function jsonRequest(path, method, body) {
  const response = await apiFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.details?.[0]?.message;
    throw new Error(detail || data.error || data.message || `API error ${response.status}`);
  }
  return data;
}

// Every change shows on the To-Do list and the Calendar too.
export const useReminderMutations = () => {
  const qc = useQueryClient();
  const settle = () => {
    qc.invalidateQueries({ queryKey: ['reminders'] });
    qc.invalidateQueries({ queryKey: ['todos'] });
    qc.invalidateQueries({ queryKey: ['calendar-auto-events'] });
  };
  const options = (mutationFn) => ({ mutationFn, onSettled: settle });
  return {
    create: useMutation(options((data) => jsonRequest('/api/reminders', 'POST', data))),
    update: useMutation(options(({ id, ...data }) => jsonRequest(`/api/reminders/${id}`, 'PATCH', data))),
    remove: useMutation(options((id) => jsonRequest(`/api/reminders/${id}`, 'DELETE'))),
    complete: useMutation(options(({ id, due_date }) => jsonRequest(`/api/reminders/${id}/complete`, 'POST', { due_date, today: localToday() }))),
    undoComplete: useMutation(options(({ id, due_date }) => jsonRequest(`/api/reminders/${id}/undo-complete`, 'POST', { due_date }))),
  };
};

// ─── Push notifications ───────────────────────────────────────────────────────
export const usePushConfig = () => useQuery({ queryKey: ['push', 'config'], queryFn: () => fetcher('/api/push/config'), staleTime: 1000 * 60 * 30 });
export const usePushSettings = () => useQuery({ queryKey: ['push', 'settings'], queryFn: () => fetcher('/api/push/settings') });

export const usePushMutations = () => {
  const qc = useQueryClient();
  const onSuccess = (data) => { if (data && 'devices' in data) qc.setQueryData(['push', 'settings'], data); };
  return {
    save: useMutation({ mutationFn: (changes) => jsonRequest('/api/push/settings', 'PUT', changes), onSuccess }),
    subscribe: useMutation({ mutationFn: (body) => jsonRequest('/api/push/subscriptions', 'POST', body), onSuccess }),
    unsubscribe: useMutation({ mutationFn: (endpoint) => jsonRequest('/api/push/subscriptions', 'DELETE', { endpoint }), onSuccess }),
    removeDevice: useMutation({ mutationFn: (id) => jsonRequest(`/api/push/subscriptions/${id}`, 'DELETE'), onSuccess }),
    test: useMutation({ mutationFn: () => jsonRequest('/api/push/test', 'POST') }),
  };
};

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
    todos:           () => qc.invalidateQueries({ queryKey: ['todos'] }),
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

// New cashout deals from every cashout (api services/cashouts/dealAlerts.js),
// with the signed-in user's profit at their best card.
export const useCashoutDealAlerts = (enabled = true) => useQuery({
  queryKey: ['cashout', 'deal-alerts'],
  queryFn: () => fetcher('/api/cashouts/deal-alerts'),
  enabled,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
});

export const cashoutCommitmentsQuery = () => ({
  queryKey: ['cashout', 'commitments'],
  queryFn: () => fetcher('/api/cashouts/commitments'),
});
export const useCashoutCommitments = () => useQuery(cashoutCommitmentsQuery());

// Settings > Data > Import from cashouts. Preview writes nothing; commit
// writes purchases + sales, so every screen that shows them is refreshed.
const postJson = (path, body, fallback) =>
  apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || fallback);
    return data;
  });

export const useCashoutImport = () => {
  const qc = useQueryClient();
  const preview = useMutation({
    mutationFn: ({ connectionId, ...body }) => postJson(
      connectionId ? `/api/cashouts/connections/${encodeURIComponent(connectionId)}/import/preview` : '/api/cashouts/import/preview',
      body,
      'Could not read the report.',
    ),
  });
  const commit = useMutation({
    mutationFn: (body) => postJson('/api/cashouts/import/commit', body, 'Import failed. Nothing was saved.'),
    onSuccess: () => qc.invalidateQueries(),
  });
  return { preview, commit };
};

// Settings > Data > Import from cashouts > Past imports: each import, what
// it added, and an undo that removes everything it added that's still there.
export const useCashoutImports = () => useQuery({
  queryKey: ['cashout', 'imports'],
  queryFn: () => fetcher('/api/cashouts/imports'),
});
export const useCashoutImportDetail = (id) => useQuery({
  queryKey: ['cashout', 'imports', id],
  queryFn: () => fetcher(`/api/cashouts/imports/${encodeURIComponent(id)}`),
  enabled: Boolean(id),
});
export const useUndoCashoutImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => postJson(`/api/cashouts/imports/${encodeURIComponent(id)}/undo`, {}, 'Could not undo the import. Nothing was removed.'),
    onSuccess: () => qc.invalidateQueries(),
  });
};

// Settings > Data > Fill in costs from store orders (purchases the cashout
// import saved at $0).
export const useStoreOrderCosts = () => {
  const qc = useQueryClient();
  const preview = useMutation({
    mutationFn: (body) => postJson('/api/cashouts/import/costs/preview', body, 'Could not read the order export.'),
  });
  const commit = useMutation({
    mutationFn: (body) => postJson('/api/cashouts/import/costs/commit', body, 'Saving failed. Nothing was changed.'),
    onSuccess: () => qc.invalidateQueries(),
  });
  // Pairs a cashout report's rows, before they're imported, with store orders.
  const match = useMutation({
    mutationFn: (body) => postJson('/api/cashouts/import/costs/match', body, 'Could not read the order export.'),
  });
  return { preview, commit, match };
};

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

  // { id, all }: all withdraws the whole commitment, every purchase on it;
  // otherwise only this purchase comes off it. A bare id works too.
  const deleteCommitment = useMutation({
    mutationFn: (arg) => {
      const { id, all } = typeof arg === 'object' ? arg : { id: arg };
      return apiFetch(`/api/cashouts/commitments/${id}${all ? '?all=true' : ''}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || 'Failed to withdraw this commitment');
        }
        return r.json();
      });
    },
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

// ---- Email connections (E1) ----
const emailJson = async (r, fallback) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || fallback);
  return body;
};
export const useEmailSetup = () => useQuery({ queryKey: ['email', 'setup'], queryFn: () => fetcher('/api/email/setup'), staleTime: 300_000 });
export const useEmailAccounts = () => useQuery({
  queryKey: ['email', 'accounts'],
  queryFn: () => fetcher('/api/email/accounts'),
  // While a sync runs, check back every few seconds so the count updates.
  refetchInterval: (query) => (Array.isArray(query.state.data) && query.state.data.some((a) => a.syncing || a.catching_up) ? 3000 : false),
});
// `found` (the total count) is part of the key, so the list reloads when a
// background sync finds more.
export const useEmailMessages = ({ limit = 10, kind = 'all', found = 0 } = {}) => useQuery({
  queryKey: ['email', 'messages', limit, kind, found],
  queryFn: () => fetcher(`/api/email/messages?limit=${limit}${kind !== 'all' ? `&kind=${kind}` : ''}`),
  placeholderData: keepPreviousData,
});
export const useEmailMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['email'] });
  const json = (method, path, body) => apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    connect: useMutation({ mutationFn: (data) => json('POST', '/api/email/accounts', data).then((r) => emailJson(r, 'Could not connect this email.')), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, ...data }) => json('PATCH', `/api/email/accounts/${id}`, data).then((r) => emailJson(r, 'Could not save.')), onSuccess: invalidate }),
    sync: useMutation({ mutationFn: (id) => json('POST', `/api/email/accounts/${id}/sync`).then((r) => emailJson(r, 'Could not sync.')), onSettled: invalidate }),
    remove: useMutation({ mutationFn: ({ id, deleteData }) => json('DELETE', `/api/email/accounts/${id}${deleteData ? '?delete_data=true' : ''}`).then((r) => emailJson(r, 'Could not disconnect.')), onSuccess: invalidate }),
  };
};

// ---- Orders from email and matches (E3) ----
export const useEmailOrders = ({ state = 'review', limit = 20, found = 0 } = {}) => useQuery({
  queryKey: ['email', 'orders', state, limit, found],
  queryFn: () => fetcher(`/api/email/orders?state=${state}&limit=${limit}`),
  placeholderData: keepPreviousData,
});
export const useEmailAutomation = () => useQuery({ queryKey: ['email', 'automation'], queryFn: () => fetcher('/api/email/automation') });
export const useEmailOrderMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['email'] });
    qc.invalidateQueries({ queryKey: ['todos'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };
  const post = (path, body) => apiFetch(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => emailJson(r, 'Could not save.'));
  return {
    accept: useMutation({ mutationFn: (id) => post(`/api/email/matches/${id}/accept`), onSuccess: invalidate }),
    reject: useMutation({ mutationFn: (id) => post(`/api/email/matches/${id}/reject`), onSuccess: invalidate }),
    acceptAll: useMutation({ mutationFn: () => post('/api/email/matches/accept-all'), onSuccess: invalidate }),
    dismiss: useMutation({ mutationFn: ({ id, restore = false }) => post(`/api/email/orders/${id}/dismiss`, { restore }), onSuccess: invalidate }),
    automation: useMutation({
      mutationFn: (changes) => apiFetch('/api/email/automation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }).then((r) => emailJson(r, 'Could not save.')),
      onSuccess: (data) => qc.setQueryData(['email', 'automation'], data),
    }),
  };
};

// What "Review & link" would change, before linking (read-only).
export const useEmailMatchPreview = (matchId) => useQuery({
  queryKey: ['email', 'match-preview', matchId],
  queryFn: () => fetcher(`/api/email/matches/${matchId}/preview`),
  enabled: Boolean(matchId),
  staleTime: 0,
});

// Email automation review: how many automatic changes wait for a confirm
// (Automation page tabs and the optional To-Do card; never the nav badge).
export const useAutomationReview = () => useQuery({ queryKey: ['email', 'automation-review'], queryFn: () => fetcher('/api/email/automation/review') });
export const useAutomationReviewMutations = () => {
  const qc = useQueryClient();
  const post = (path, body) => apiFetch(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => emailJson(r, 'Could not save.'));
  return {
    confirm: useMutation({
      mutationFn: (ids) => post('/api/email/automation/confirm', { ids }),
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['activity'] }); qc.invalidateQueries({ queryKey: ['email', 'automation-review'] }); },
    }),
    // "No" takes the change back, so the records it touched refresh too.
    reject: useMutation({ mutationFn: (id) => post(`/api/email/automation/${id}/reject`), onSuccess: () => qc.invalidateQueries() }),
    // Names a purchase made from an email (a past purchase's name, or typed).
    name: useMutation({ mutationFn: ({ id, name }) => post(`/api/email/automation/${id}/name`, { name }), onSuccess: () => qc.invalidateQueries() }),
  };
};

// ---- Trusted store rules (E4) ----
export const useEmailStores = () => useQuery({ queryKey: ['email', 'stores'], queryFn: () => fetcher('/api/email/stores') });
export const useEmailStoreMutations = () => {
  const qc = useQueryClient();
  const send = (method, path) => apiFetch(path, { method }).then((r) => emailJson(r, 'Could not save.'));
  const refresh = () => qc.invalidateQueries({ queryKey: ['email', 'stores'] });
  return {
    scan: useMutation({ mutationFn: () => send('POST', '/api/email/stores/scan'), onSuccess: (data) => qc.setQueryData(['email', 'stores'], data) }),
    request: useMutation({ mutationFn: ({ id, on }) => send(on ? 'POST' : 'DELETE', `/api/email/stores/${id}/request`), onSuccess: refresh }),
    hide: useMutation({ mutationFn: ({ id, on }) => send(on ? 'POST' : 'DELETE', `/api/email/stores/${id}/hide`), onSuccess: (data) => qc.setQueryData(['email', 'stores'], data) }),
  };
};
export const useEmailRules = () => useQuery({ queryKey: ['email', 'rules'], queryFn: () => fetcher('/api/email/rules') });
export const useEmailRuleMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['email'] }); qc.invalidateQueries({ queryKey: ['expenses'] }); };
  const send = (method, path, body) => apiFetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => emailJson(r, 'Could not save.'));
  return {
    save: useMutation({ mutationFn: (rule) => send('POST', '/api/email/rules', rule), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id) => send('DELETE', `/api/email/rules/${id}`), onSuccess: invalidate }),
    addExpense: useMutation({ mutationFn: (orderId) => send('POST', `/api/email/orders/${orderId}/expense`), onSuccess: invalidate }),
    addPurchase: useMutation({ mutationFn: (orderId) => send('POST', `/api/email/orders/${orderId}/purchase`), onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['todos'] }); } }),
    saveInvoice: useMutation({ mutationFn: (orderId) => send('POST', `/api/email/orders/${orderId}/save-invoice`), onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['inventory'] }); } }),
    handled: useMutation({ mutationFn: (orderId) => send('POST', `/api/email/orders/${orderId}/handled`), onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['todos'] }); } }),
  };
};
