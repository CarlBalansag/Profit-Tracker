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
  expensesPageQuery,
  goalsQuery,
  inventoryQuery,
  paymentMethodsQuery,
  platformsQuery,
  productNamesQuery,
  receiptsPageQuery,
  salesQuery,
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
  '/expenses': { code: Pages.Expenses.preload, data: () => [expensesPageQuery(), paymentMethodsQuery()] },
  '/schedule-c': { code: Pages.ScheduleC.preload, data: () => [] },
  '/receipts': { code: Pages.Receipts.preload, data: () => [receiptsPageQuery()] },
  '/invoices': { code: Pages.Invoices.preload, data: () => [] },
  '/tax-exempt': { code: Pages.TaxExempt.preload, data: () => [inventoryQuery(), salesQuery()] },
  '/analytics': { code: Pages.Analytics.preload, data: () => [dashboardQuery('All', 'All Time')] },
  '/cashflow': { code: Pages.CashFlow.preload, data: () => [dashboardQuery('All', 'All Time')] },
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

export const PREFETCH_PATHS = Object.keys(PAGES);
