import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import Cashout from './Cashout';
import {
  dealConditionLabels,
  dealLimitLabel,
  dealStoreLinks,
  estimateDealProfit,
  formatDealExpiry,
  formatLastSynced,
  isDealExpired,
  parseDealNotes,
  storeLogoUrl,
} from '../utils/cashoutDeals';

const mockProviders = [{ id: 'eb', name: 'ElectronicsBuyer' }];
const mockConnections = [
  {
    id: 'conn-1',
    provider: 'eb',
    displayName: 'EB Primary',
    keyLast4: '9876',
    status: 'active',
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
  },
];
const mockDeals = {
  results: [
    {
      connection: mockConnections[0],
      isStale: false,
      lastUpdated: new Date().toISOString(),
      deals: [
        {
          id: '5232',
          name: 'Airpod 5 ANC',
          retail: 119.0,
          payout: 119.0,
          profitMargin: 0.0,
        },
        {
          id: '9999',
          name: 'Unmatched Unknown Widget',
          retail: 40.0,
          payout: 35.0,
          profitMargin: -12.5,
        },
      ],
    },
  ],
};

const mockMutations = {
  addConnection: { mutateAsync: vi.fn(), isPending: false },
  deleteConnection: { mutateAsync: vi.fn(), isPending: false },
  testConnection: { mutateAsync: vi.fn(), isPending: false },
  syncConnection: { mutateAsync: vi.fn(), isPending: false },
};

let currentProviders = mockProviders;
let currentConnections = mockConnections;
let currentDeals = mockDeals;
const gainRowButton = () => within(screen.getByText('Gain Deal').closest('tr')).getByRole('button', { name: 'Log Deal' });
let dealsState = {};
let connectionsState = {};
let providersState = {};
const refetchDeals = vi.fn();

vi.mock('../hooks/useApi', () => ({
  useCashoutProviders: () => ({ data: currentProviders, isLoading: false, error: null, refetch: vi.fn(), ...providersState }),
  useCashoutConnections: () => ({ data: currentConnections, isLoading: false, error: null, refetch: vi.fn(), ...connectionsState }),
  useCashoutDeals: () => ({ data: currentDeals, isLoading: false, error: null, refetch: refetchDeals, isFetching: false, ...dealsState }),
  useCashoutMutations: () => mockMutations,
}));

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

afterEach(cleanup);

describe('Cashout Page', () => {
  beforeEach(() => {
    currentProviders = mockProviders;
    currentConnections = mockConnections;
    currentDeals = mockDeals;
    dealsState = {};
    connectionsState = {};
    providersState = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.matchMedia;
  });

  it('renders "Cashout is not available" when user has 0 available providers', () => {
    currentProviders = [];
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByText('Cashout is not available')).toBeInTheDocument();
    expect(screen.getByText(/private preview/i)).toBeInTheDocument();
  });

  it('renders "No cashouts connected" when user has access but 0 connections', () => {
    currentConnections = [];
    currentDeals = { results: [] };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByText('No cashouts connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Cashout/i })).toBeInTheDocument();
  });

  it('renders the live deals with their payouts and nothing about our own costs', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByText('Cashout Deals')).toBeInTheDocument();
    expect(screen.getByText('Airpod 5 ANC')).toBeInTheDocument();
    expect(screen.getAllByText('$119.00')).toHaveLength(2); // payout and retail
    expect(screen.getByText('Unmatched Unknown Widget')).toBeInTheDocument();
    expect(screen.getByText('$35.00')).toBeInTheDocument();

    for (const removed of [/Your Cost/i, /Cashback/i, /Estimated Profit/i, /Avg Profit/i, /In Stock/i, /No cost data/i, /Match Item/i, /Change Match/i]) {
      expect(screen.queryByText(removed)).not.toBeInTheDocument();
    }
  });

  it('sorts by highest profit by default', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Biggest Payout', retail: 1349.99, payout: 1350 },
          { id: '2', name: 'Biggest Profit', retail: 899.99, payout: 1140 },
        ],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Biggest Profit');
    expect(rows[1]).toHaveTextContent('Biggest Payout');
  });

  it('estimates profit as payout minus retail, to the cent', () => {
    expect(estimateDealProfit({ payout: 1140, retail: 899.99 })).toEqual({ amount: 240.01, pct: 26.67 });
    expect(estimateDealProfit({ payout: 16, retail: 14.99 })).toEqual({ amount: 1.01, pct: 6.74 });
    expect(estimateDealProfit({ payout: 35, retail: 40 })).toEqual({ amount: -5, pct: -12.5 });
    expect(estimateDealProfit({ payout: 119, retail: 119 })).toEqual({ amount: 0, pct: 0 });
  });

  it('gives no estimate without both prices, rather than a made-up number', () => {
    expect(estimateDealProfit({ payout: 100, retail: null })).toBeNull();
    expect(estimateDealProfit({ payout: 100, retail: 0 })).toBeNull();
    expect(estimateDealProfit({ payout: 0, retail: 100 })).toBeNull();
    expect(estimateDealProfit({ payout: 'n/a', retail: 100 })).toBeNull();
  });

  it('shows gains, losses and missing estimates in the Est. Profit column', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Gain Deal', retail: 899.99, payout: 1140 },
          { id: '2', name: 'Loss Deal', retail: 40, payout: 35 },
          { id: '3', name: 'No Retail Deal', retail: null, payout: 50 },
        ],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(
      ['Deal / Item', 'Cashout', 'Payout', 'Retail', 'Est. Profit', 'Expires', 'Buy At', 'Actions'],
    );
    expect(gainRowButton()).toBeDisabled();
    const gainRow = screen.getByText('Gain Deal').closest('tr');
    expect(gainRow.cells[2]).toHaveTextContent('$1,140.00');
    expect(gainRow.cells[3]).toHaveTextContent('$899.99');
    expect(screen.getByText('No Retail Deal').closest('tr').cells[3]).toHaveTextContent('—');

    expect(screen.getByText('Est. Profit')).toBeInTheDocument();
    expect(screen.getByText('+$240.01')).toBeInTheDocument();
    expect(screen.getByText('+26.67%')).toBeInTheDocument();
    expect(screen.getByText('-$5.00')).toBeInTheDocument();
    expect(screen.getByText('-12.5%')).toBeInTheDocument();
    expect(screen.getByText('No Retail Deal').closest('tr')).toHaveTextContent('—');
  });

  it('filters by category: all deals, above retail, or at or below retail', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Above Deal', retail: 1349.99, payout: 1350 },
          { id: '2', name: 'Below Deal', retail: 40, payout: 35 },
          { id: '3', name: 'Equal Deal', retail: 119, payout: 119 },
          { id: '4', name: 'No Retail Deal', retail: null, payout: 50 },
        ],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );
    const names = () => screen.getAllByRole('row').slice(1).map((row) => row.cells[0].textContent);
    const category = screen.getByLabelText('Filter by category');

    expect(category).toHaveValue('all');
    expect(names()).toHaveLength(4);

    fireEvent.change(category, { target: { value: 'above_retail' } });
    expect(names()).toEqual(['Above Deal']);

    fireEvent.change(category, { target: { value: 'close_to_retail' } });
    expect(names()).toEqual(['Equal Deal', 'Below Deal']);

    fireEvent.change(category, { target: { value: 'all' } });
    expect(names()).toHaveLength(4);
  });

  it('has no Payout History screen', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.queryByText('Payout History')).not.toBeInTheDocument();
    expect(screen.getByText('Live Deals')).toBeInTheDocument();
  });

  it('shows the newest sync time in the viewer time zone', () => {
    const results = [
      { lastUpdated: '2026-11-06T15:00:00Z' },
      { lastUpdated: '2026-11-06T17:52:00Z' },
      { lastUpdated: null },
    ];
    expect(formatLastSynced(results, 'America/Los_Angeles')).toMatch(/Nov 6.*9:52.*AM.*PST/);
    expect(formatLastSynced(results, 'America/New_York')).toMatch(/Nov 6.*12:52.*PM.*EST/);
    expect(formatLastSynced([], 'UTC')).toBeNull();
    expect(formatLastSynced(undefined, 'UTC')).toBeNull();
  });

  it('shows when deals last synced under Sync now, and nothing before the first sync', () => {
    const { unmount } = render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );
    expect(screen.getByText(/^Last synced /)).toBeInTheDocument();
    unmount();

    currentDeals = { results: [{ connection: mockConnections[0], deals: [], lastUpdated: null }] };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );
    expect(screen.queryByText(/^Last synced /)).not.toBeInTheDocument();
  });

  describe('notes', () => {
    const NOTES = 'Use Code: IDEA3FLASH\nDeliver To: Delaware Only\n\n📌 Dropship To:\nCSG LLC\n202 Carson Dr\nBear, DE 19701';

    it('separates the address and delivery rule from the rest of the note', () => {
      expect(parseDealNotes(NOTES)).toEqual({
        note: 'Use Code: IDEA3FLASH',
        address: 'CSG LLC\n202 Carson Dr\nBear, DE 19701',
        deliverTo: 'Delaware Only',
      });
    });

    it('handles notes with only an address, or with neither', () => {
      expect(parseDealNotes('📌 Dropship To:\nCSG LLC\n202 Carson Dr')).toEqual({ note: '', address: 'CSG LLC\n202 Carson Dr', deliverTo: null });
      expect(parseDealNotes('Deal Extended\nPrice Match Available')).toEqual({ note: 'Deal Extended Price Match Available', address: null, deliverTo: null });
      expect(parseDealNotes(null)).toEqual({ note: '', address: null, deliverTo: null });
    });

    it('keeps note lines that come after the address block', () => {
      expect(parseDealNotes('Dropship To:\nCSG LLC\n\nCall first')).toEqual({ note: 'Call first', address: 'CSG LLC', deliverTo: null });
    });

    it('copies the address and shows the delivery rule as a tag', async () => {
      const writeText = vi.fn().mockResolvedValue();
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      currentDeals = { results: [{ connection: mockConnections[0], deals: [{ id: '1', name: 'Deal', payout: 10, notes: NOTES }] }] };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      expect(screen.getByText('Delaware Only')).toBeInTheDocument();
      expect(screen.getByText('Use Code: IDEA3FLASH')).toBeInTheDocument();
      expect(screen.queryByText(/Carson Dr/)).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy Address' }));
      });

      expect(writeText).toHaveBeenCalledWith('CSG LLC\n202 Carson Dr\nBear, DE 19701');
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });
  });

  it('labels conditions other than new, and vendor limits', () => {
    expect(dealConditionLabels({ items: [{ condition: 'DMG_BOX' }] })).toEqual(['Damaged Box']);
    expect(dealConditionLabels({ items: [{ condition: 'new' }] })).toEqual([]);
    expect(dealConditionLabels({ items: [{ condition: 'OPEN_BOX' }] })).toEqual(['OPEN BOX']);

    expect(dealLimitLabel({ items: [{ vendorLimit: 100 }] })).toBe('Limit 100');
    expect(dealLimitLabel({ items: [{ vendorLimit: 12 }, { vendorLimit: 6 }] })).toBe('Limit 6–12');
    expect(dealLimitLabel({ items: [{ vendorLimit: null }] })).toBeNull();
  });

  it('shows featured, condition and limit tags on a deal', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [{ id: '1', name: 'Tagged Deal', payout: 10, featured: true, items: [{ name: 'Tagged', condition: 'DMG_BOX', vendorLimit: 100 }] }],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByText('Featured')).toBeInTheDocument();
    expect(screen.getByText('Damaged Box')).toBeInTheDocument();
    expect(screen.getByText('Limit 100')).toBeInTheDocument();
  });

  describe('filters', () => {
    const buy = (name) => ({ name, url: `https://${name.toLowerCase()}.example/p` });
    const names = () => screen.getAllByRole('row').slice(1).map((row) => within(row.cells[0]).getByTitle(/Deal/).textContent);
    const dayFromNow = (days) => new Date(Date.now() + days * 86400000).toISOString();

    beforeEach(() => {
      currentDeals = {
        results: [{
          connection: mockConnections[0],
          deals: [
            { id: '1', name: 'Amazon Deal', payout: 100, retail: 90, expiresAt: dayFromNow(9), items: [{ name: 'A', purchaseLinks: [buy('Amazon')] }] },
            { id: '2', name: 'Both Deal', payout: 100, retail: 80, expiresAt: dayFromNow(2), items: [{ name: 'B', purchaseLinks: [buy('Amazon'), buy('Target')] }] },
            { id: '3', name: 'Expired Deal', payout: 100, retail: 50, expiresAt: dayFromNow(-1), items: [{ name: 'C', purchaseLinks: [buy('Target')] }] },
            { id: '4', name: 'Open Deal', payout: 100, retail: 95, expiresAt: null, items: [{ name: 'D', purchaseLinks: [buy('Walmart')] }] },
          ],
        }],
      };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );
    });

    it('hides expired deals until asked, and leaves them out of the live count', () => {
      expect(names()).toEqual(['Both Deal', 'Amazon Deal', 'Open Deal']);
      expect(screen.getByText('Live Deals').nextSibling).toHaveTextContent('3');

      fireEvent.click(screen.getByLabelText('Show expired (1)'));

      expect(names()).toContain('Expired Deal');
      expect(screen.getByText('Live Deals').nextSibling).toHaveTextContent('3');
    });

    it('filters to one store, including deals sold at several', () => {
      const store = screen.getByLabelText('Filter by store');
      expect(within(store).getAllByRole('option').map((o) => o.textContent)).toEqual(['All Stores', 'Amazon', 'Target', 'Walmart']);

      fireEvent.change(store, { target: { value: 'Amazon' } });
      expect(names()).toEqual(['Both Deal', 'Amazon Deal']);
    });

    it('sorts by ending soon, with no expiration last', () => {
      fireEvent.change(screen.getByLabelText('Sort deals'), { target: { value: 'ending_soon' } });
      expect(names()).toEqual(['Both Deal', 'Amazon Deal', 'Open Deal']);
    });
  });

  it('knows which deals are expired', () => {
    const now = new Date('2026-11-06T17:00:00Z').getTime();
    expect(isDealExpired({ expiresAt: '2026-11-05T08:00:00Z' }, now)).toBe(true);
    expect(isDealExpired({ expiresAt: '2026-11-20T08:00:00Z' }, now)).toBe(false);
    expect(isDealExpired({ expiresAt: null }, now)).toBe(false);
  });

  describe('loading and errors', () => {
    it('shows a loading message instead of an empty result while deals load', () => {
      dealsState = { data: undefined, isLoading: true };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      expect(screen.getByText('Loading cashout deals…')).toBeInTheDocument();
      expect(screen.queryByText(/No cashout deals matched/)).not.toBeInTheDocument();
    });

    it('does not flash the empty state while connections load', () => {
      currentConnections = [];
      connectionsState = { data: undefined, isLoading: true };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      expect(screen.queryByText('No cashouts connected')).not.toBeInTheDocument();
    });

    it('shows an error, not "not available", when the access check fails', () => {
      currentProviders = [];
      providersState = { data: undefined, error: new Error('API error 500') };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      expect(screen.queryByText('Cashout is not available')).not.toBeInTheDocument();
      expect(screen.getByText(/cashout data/i)).toBeInTheDocument();
    });

    it('explains what went wrong in the banner', () => {
      currentDeals = {
        results: [{
          connection: mockConnections[0],
          deals: [],
          isStale: true,
          warning: 'Failed to refresh: ElectronicsBuyer returned HTTP 503. Showing last known data.',
        }],
      };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      expect(screen.getByText(/returned HTTP 503/)).toBeInTheDocument();
    });

    it('says when a failed sync failed, instead of reporting success', async () => {
      mockMutations.syncConnection.mutateAsync.mockRejectedValueOnce(new Error('Failed to refresh: down'));
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Sync now/i }));
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to refresh: down', expect.anything());
      expect(toast.success).not.toHaveBeenCalled();
      expect(refetchDeals).toHaveBeenCalled();
    });

    it('treats a cooldown as information, not an error', async () => {
      const cooldown = Object.assign(new Error('Please wait 30s'), { cooldown: true, remainingSeconds: 30 });
      mockMutations.syncConnection.mutateAsync.mockRejectedValueOnce(cooldown);
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Sync now/i }));
      });

      expect(toast.info).toHaveBeenCalledWith('Please wait 30s', expect.anything());
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  it('shows cards instead of the table on phones', () => {
    window.matchMedia = (query) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [{
          id: '1',
          name: 'PS5 Pro',
          retail: 899.99,
          payout: 1140,
          items: [{ name: 'PS5 Pro', purchaseLinks: [{ name: 'Amazon', url: 'https://www.amazon.com/dp/1' }] }],
        }],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent('PS5 Pro');
    expect(card).toHaveTextContent('$1,140.00');
    expect(card).toHaveTextContent('$899.99');
    expect(card).toHaveTextContent('+$240.01');
    expect(within(card).getByRole('link', { name: 'Buy at Amazon' })).toBeInTheDocument();
  });

  it('counts down to the expiration date and flags expired deals', () => {
    const now = new Date('2026-11-06T17:00:00Z');
    expect(formatDealExpiry('2026-11-20T08:00:00Z', now)).toMatchObject({ note: '14 days left', expired: false, urgent: false });
    expect(formatDealExpiry('2026-11-07T08:00:00Z', now)).toMatchObject({ note: '1 day left', urgent: true });
    expect(formatDealExpiry('2026-11-05T08:00:00Z', now)).toMatchObject({ note: 'Expired', expired: true });
    expect(formatDealExpiry(null, now)).toBeNull();
    expect(formatDealExpiry('not a date', now)).toBeNull();
  });

  it('lists each purchase link once and says which item it buys when there are several', () => {
    const shared = { name: 'Amazon', url: 'https://www.amazon.com/dp/1' };
    expect(dealStoreLinks({
      items: [{ name: 'PS5 Pro', purchaseLinks: [shared] }],
      productLinks: [shared],
    })).toEqual([{ ...shared, label: 'Buy at Amazon' }]);

    const colors = dealStoreLinks({
      items: [
        { name: 'Neo Silver', purchaseLinks: [{ name: 'Amazon', url: 'https://ftc.cash/a' }] },
        { name: 'Neo Black', purchaseLinks: [{ name: 'Amazon', url: 'https://ftc.cash/b' }] },
      ],
      productLinks: [],
    });
    expect(colors.map((link) => link.label)).toEqual(['Buy Neo Silver at Amazon', 'Buy Neo Black at Amazon']);
  });

  it('ignores links that are not normal web addresses', () => {
    expect(dealStoreLinks({
      items: [{ name: 'Item', purchaseLinks: [{ name: 'Bad', url: 'javascript:alert(1)' }, { name: 'Broken', url: 'nope' }] }],
    })).toEqual([]);
  });

  it('finds logos by store name, whatever the link address is', () => {
    expect(storeLogoUrl('Amazon')).toContain('amazon.com');
    expect(storeLogoUrl('BestBuy')).toContain('bestbuy.com');
    expect(storeLogoUrl("Sam's Club")).toContain('samsclub.com');
    expect(storeLogoUrl('Micro Center')).toContain('microcenter.com');
    expect(storeLogoUrl('Some New Store')).toBeNull();
  });

  it('shows the expiration and a store logo that links straight to the purchase page', () => {
    const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [{
          id: '1',
          name: 'PS5 Pro',
          retail: 899.99,
          payout: 1140,
          expiresAt,
          avgRemainingPercentage: 40,
          items: [{
            name: 'PS5 Pro',
            purchaseLinks: [
              { name: 'Amazon', url: 'https://www.amazon.com/dp/1' },
              { name: 'New Store', url: 'https://example.com/ps5' },
            ],
          }],
        }],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByText('5 days left')).toBeInTheDocument();
    expect(screen.queryByText('Cap')).not.toBeInTheDocument();

    const amazon = screen.getByRole('link', { name: 'Buy at Amazon' });
    expect(amazon).toHaveAttribute('href', 'https://www.amazon.com/dp/1');
    expect(amazon).toHaveAttribute('target', '_blank');
    expect(amazon.querySelector('img')).toHaveAttribute('src', expect.stringContaining('amazon.com'));

    // No known logo falls back to the store's first letter.
    expect(screen.getByRole('link', { name: 'Buy at New Store' })).toHaveTextContent('N');
  });

  it('falls back to the first letter when a logo fails to load', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [{ id: '1', name: 'Deal', payout: 10, items: [{ name: 'Deal', purchaseLinks: [{ name: 'Target', url: 'https://www.target.com/p/1' }] }] }],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: 'Buy at Target' });
    fireEvent.error(link.querySelector('img'));
    expect(link.querySelector('img')).toBeNull();
    expect(link).toHaveTextContent('T');
  });

  it('sorts by highest profit with deals that have no estimate last', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Biggest Payout Small Profit', retail: 990, payout: 1000 },
          { id: '2', name: 'No Retail Deal', retail: null, payout: 2000 },
          { id: '3', name: 'Small Payout Big Profit', retail: 100, payout: 300 },
          { id: '4', name: 'Loss Deal', retail: 40, payout: 35 },
        ],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.cells[0].textContent)).toEqual([
      'Small Payout Big Profit',
      'Biggest Payout Small Profit',
      'Loss Deal',
      'No Retail Deal',
    ]);
  });

  it('opens and closes the Manage Connections modal', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const manageBtn = screen.getByRole('button', { name: /Manage Connections/i });
    fireEvent.click(manageBtn);

    expect(screen.getByText('Connected Cashout Services')).toBeInTheDocument();
    expect(screen.getAllByText('EB Primary').length).toBeGreaterThan(0);
    expect(screen.getByText(/••••••••••••9876/)).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);

    expect(screen.queryByText('Connected Cashout Services')).not.toBeInTheDocument();
  });

  it('filters deals by search query', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const searchInput = screen.getByPlaceholderText(/Search deals, UPCs, items…/i);
    fireEvent.change(searchInput, { target: { value: 'Airpod' } });

    expect(screen.getByText('Airpod 5 ANC')).toBeInTheDocument();
    expect(screen.queryByText('Unmatched Unknown Widget')).not.toBeInTheDocument();
  });
});
