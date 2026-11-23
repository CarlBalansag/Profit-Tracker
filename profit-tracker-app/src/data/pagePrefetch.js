import {
  buyersQuery,
  calendarAutoEventsQuery,
  calendarEventsQuery,
  cashoutCommitmentsQuery,
  cashoutConnectionsQuery,
  cashoutDealsQuery,
  cashoutProvidersQuery,
  creditCardQuery,
  dashboardQuery,
  cashFlowQuery,
  expensesPageQuery,
  goalsQuery,
  inventoryQuery,
  paymentMethodsQuery,
  platformsQuery,
  productNamesQuery,
  receiptsPageQuery,
  salesQuery,
  todosQuery,
} from '../hooks/useApi';
import * as Pages from '../pages/lazyPages';

// Hover prefetching: when the pointer rests on a nav link (or it gets focus
// or a touch), load that page's code and the data it reads first, so the
// page usually opens fully drawn instead of empty. Each entry must match
// what the page itself asks for on first render (same query keys), or the
// prefetch just warms an entry nobody reads.
//
// Pages whose first query depends on a saved choice (Dashboard's date filter)
// only prefetch what doesn't.

const utcMonthKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`; // CreditCard.jsx
const localMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; // Calendar.jsx

const PAGES = {
  '/': { code: Pages.Dashboard.preload, data: () => [goalsQuery()] },
  '/add-transaction': {
    code: Pages.AddTransaction.preload,
    data: () => [buyersQuery(), paymentMethodsQuery(), platformsQuery(), productNamesQuery()],
  },
  '/add-sale': {
    code: Pages.AddSale.preload,
    data: () => [inventoryQuery(), paymentMethodsQuery(), platformsQuery()],
  },
  '/transactions': {
    code: Pages.Transactions.preload,
    data: () => [inventoryQuery(), buyersQuery(), paymentMethodsQuery(), platformsQuery()],
  },
  '/inventory': { code: Pages.Inventory.preload, data: () => [inventoryQuery()] },
  '/shipping': { code: Pages.Shipping.preload, data: () => [inventoryQuery(), salesQuery()] },
  '/statuses': { code: Pages.Statuses.preload, data: () => [inventoryQuery(), salesQuery()] },
  '/todos': { code: Pages.Todos.preload, data: () => [todosQuery()] },
  '/expenses': { code: Pages.Expenses.preload, data: () => [expensesPageQuery(), paymentMethodsQuery()] },
  '/schedule-c': { code: Pages.ScheduleC.preload, data: () => [] },
  '/receipts': { code: Pages.Receipts.preload, data: () => [receiptsPageQuery()] },
  '/invoices': { code: Pages.Invoices.preload, data: () => [] },
  '/tax-exempt': { code: Pages.TaxExempt.preload, data: () => [inventoryQuery(), salesQuery()] },
  '/analytics': { code: Pages.Analytics.preload, data: () => [dashboardQuery('All', 'All Time')] },
  '/cashflow': { code: Pages.CashFlow.preload, data: () => [cashFlowQuery()] },
  '/creditcard': { code: Pages.CreditCard.preload, data: () => [creditCardQuery(utcMonthKey(new Date()))] },
  '/goals': {
    code: Pages.Goals.preload,
    data: () => [
      goalsQuery(),
      dashboardQuery('All', '7 Days'),
      dashboardQuery('All', '30 Days'),
      dashboardQuery('All', 'YTD'),
      dashboardQuery('All', 'All Time'),
    ],
  },
  '/calendar': {
    code: Pages.Calendar.preload,
    data: () => {
      const month = localMonthKey(new Date());
      return [calendarEventsQuery(month), calendarAutoEventsQuery(month)];
    },
  },
  '/cashout': {
    code: Pages.Cashout.preload,
    data: () => [
      cashoutProvidersQuery(),
      cashoutConnectionsQuery(),
      cashoutDealsQuery(),
      cashoutCommitmentsQuery(),
      paymentMethodsQuery(),
      platformsQuery(),
    ],
  },
  '/settings': { code: Pages.Settings.preload, data: () => [] },
  '/activity': { code: Pages.Activity.preload, data: () => [] },
  '/automation': { code: Pages.Automation.preload, data: () => [] },
  '/guide': { code: Pages.Guide.preload, data: () => [] },
};

// Data fetched in the last 30 s isn't fetched again by a prefetch (pages
// still refresh on their own schedule when they open).
const PREFETCH_FRESH_MS = 30_000;

export function prefetchPage(queryClient, path) {
  const page = PAGES[path];
  if (!page) return;
  page.code().catch(() => {}); // a failed chunk load is retried when the page opens
  if (!queryClient || navigator.connection?.saveData) return;
  for (const query of page.data()) {
    queryClient.prefetchQuery({ ...query, staleTime: Math.max(query.staleTime ?? 0, PREFETCH_FRESH_MS) });
  }
}

// Load every page's code (not data) once the browser is idle, so even a page
// you click without hovering doesn't wait on its chunk.
export function prefetchAllPageCode() {
  Object.values(PAGES).forEach((page) => page.code().catch(() => {}));
}

// The cheap data several pages share, preloaded once the app is idle so most
// pages open fully drawn even on a first click without hovering. The heavy
// ones (Dashboard analytics for Analytics/Goals/Cash Flow, Cashout, which
// keeps polling) are left to hover prefetch, for when you're about to open
// them. Sent one at a time so they never crowd the page you're looking at.
const SHARED_DATA = () => [
  inventoryQuery(),      // Transactions, Inventory, Shipping, Statuses, Tax Exempt, Record Sale
  salesQuery(),          // Shipping, Statuses, Tax Exempt
  expensesPageQuery(),   // Expenses (3 requests)
  receiptsPageQuery(),   // Receipts
  paymentMethodsQuery(), // forms and Expenses
  platformsQuery(),      // forms and Transactions
  buyersQuery(),         // forms and Transactions
];

const slowConnection = () => {
  const connection = typeof navigator === 'undefined' ? null : navigator.connection;
  return Boolean(connection?.saveData) || ['slow-2g', '2g'].includes(connection?.effectiveType);
};

let sharedDataStarted = false;

export async function prefetchSharedData(queryClient) {
  if (!queryClient || sharedDataStarted || slowConnection()) return;
  sharedDataStarted = true;
  for (const query of SHARED_DATA()) {
    // prefetchQuery never throws; anything loaded in the last 30 s is skipped.
    await queryClient.prefetchQuery({ ...query, staleTime: Math.max(query.staleTime ?? 0, PREFETCH_FRESH_MS) });
  }
}

// For tests: let prefetchSharedData run again.
export const resetSharedDataPrefetch = () => { sharedDataStarted = false; };

export const PREFETCH_PATHS = Object.keys(PAGES);
