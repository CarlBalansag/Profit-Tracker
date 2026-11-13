import { describe, expect, it, vi } from 'vitest';
import { PREFETCH_PATHS, prefetchPage } from './pagePrefetch';

// Page modules are big; the prefetch only needs to call import().
vi.mock('../pages/Dashboard', () => ({ default: () => null }));
vi.mock('../pages/Expenses', () => ({ default: () => null }));
vi.mock('../pages/Inventory', () => ({ default: () => null }));
vi.mock('../pages/Settings', () => ({ default: () => null }));

const fakeClient = () => ({ prefetchQuery: vi.fn(() => Promise.resolve()) });
const keys = (client) => client.prefetchQuery.mock.calls.map(([q]) => JSON.stringify(q.queryKey));

describe('prefetchPage', () => {
  it('warms the same cache entries the page reads', () => {
    const client = fakeClient();
    prefetchPage(client, '/expenses');
    expect(keys(client)).toEqual(['["expenses","page"]', '["payment-methods"]']);

    const inv = fakeClient();
    prefetchPage(inv, '/inventory');
    expect(keys(inv)).toEqual(['["inventory"]']);
  });

  it('never refetches data loaded in the last 30 seconds', () => {
    const client = fakeClient();
    prefetchPage(client, '/inventory');
    expect(client.prefetchQuery.mock.calls[0][0].staleTime).toBeGreaterThanOrEqual(30_000);
  });

  it('ignores paths with no page, and works with no query client', () => {
    const client = fakeClient();
    prefetchPage(client, '/nope');
    expect(client.prefetchQuery).not.toHaveBeenCalled();
    expect(() => prefetchPage(null, '/settings')).not.toThrow();
  });

  it('covers every page in the sidebar', () => {
    for (const path of ['/', '/add-transaction', '/add-sale', '/transactions', '/inventory', '/shipping', '/statuses',
      '/expenses', '/receipts', '/invoices', '/tax-exempt', '/analytics', '/cashflow', '/creditcard', '/goals',
      '/calendar', '/cashout', '/guide']) {
      expect(PREFETCH_PATHS).toContain(path);
    }
  });
});
