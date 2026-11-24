import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import Cashout from './Cashout';
import { commitmentAccountSummary } from '../utils/storeAccounts';
import {
  dealConditionLabels,
  dealLimitLabel,
  dealStoreLinks,
  estimateDealProfit,
  formatDealExpiry,
  formatDealProfit,
  formatLastSynced,
  groupDealsByProduct,
  groupStoreLinks,
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
  logPurchase: { mutateAsync: vi.fn().mockResolvedValue({ tracking_submitted: true }), isPending: false },
  deleteCommitment: { mutateAsync: vi.fn(), isPending: false },
};

let currentProviders = mockProviders;
let currentConnections = mockConnections;
let currentCommitments = [];
let currentDeals = mockDeals;
const defaultPaymentMethods = [
  { id: 'card-1', name: 'QA Card', default_cashback_rate: 2 },
  // 1% everywhere, 5% at Amazon (store rates arrive as a JSON string too).
  { id: 'card-amazon', name: 'Amazon Card', default_cashback_rate: 1, category_rates: JSON.stringify([{ store: 'Amazon', rate: 5 }]) },
];
let currentPaymentMethods = defaultPaymentMethods;
const defaultPlatforms = [
  { id: 'vendor-1', name: 'Amazon', type: 'Vendor', tax_exempt_place: false },
  { id: 'group-eb', name: 'EB', type: 'Cashout' },
  { id: 'group-p4d-short', name: 'P4D', type: 'Cashout' }, // listed first: the full name still wins
  { id: 'group-p4d', name: 'POINTS4DAYS', type: 'Cashout' },
];
let currentPlatforms = defaultPlatforms;
const gainRowButton = () => within(screen.getByText('Gain Deal').closest('tr')).getByRole('button', { name: 'Log Purchase' });
let dealsState = {};
let connectionsState = {};
let providersState = {};
const refetchDeals = vi.fn();

const mockApiFetch = vi.fn();
const mockInvalidate = { sales: vi.fn(), cashouts: vi.fn() };
vi.mock('../hooks/useApi', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
  useInvalidate: () => mockInvalidate,
  useCashoutProviders: () => ({ data: currentProviders, isLoading: false, error: null, refetch: vi.fn(), ...providersState }),
  useCashoutConnections: () => ({ data: currentConnections, isLoading: false, error: null, refetch: vi.fn(), ...connectionsState }),
  useCashoutDeals: () => ({ data: currentDeals, isLoading: false, error: null, refetch: refetchDeals, isFetching: false, ...dealsState }),
  useCashoutMutations: () => mockMutations,
  useCashoutCommitments: () => ({ data: currentCommitments, isLoading: false, error: null }),
  usePlatforms: () => ({
    data: currentPlatforms,
    isLoading: false,
    error: null,
  }),
  usePaymentMethods: () => ({ data: currentPaymentMethods, isLoading: false, error: null }),
}));

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

afterEach(cleanup);

describe('Cashout Page', () => {
  beforeEach(() => {
    currentProviders = mockProviders;
    currentConnections = mockConnections;
    currentDeals = mockDeals;
    currentCommitments = [];
    currentPaymentMethods = defaultPaymentMethods;
    currentPlatforms = defaultPlatforms;
    dealsState = {};
    connectionsState = {};
    providersState = {};
    vi.clearAllMocks();
    localStorage.clear();
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

  it('renders "See Cashout Deals Now" with the available integrations when user has access but 0 connections', () => {
    currentConnections = [];
    currentDeals = { results: [] };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByText('See Cashout Deals Now')).toBeInTheDocument();
    expect(screen.getByText('ElectronicsBuyer')).toBeInTheDocument();
    // Keys are entered in Data Setup, so this leads there rather than opening a form.
    expect(screen.getByRole('link', { name: /Connect your API keys/i })).toHaveAttribute('href', '/settings');
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

  it('sorts by recently added by default, using when a deal was first seen when the cashout gives no date', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Oldest', retail: 899.99, payout: 1140, createdAt: '2026-11-20T10:00:00Z' },
          { id: '2', name: 'Newest Posted', retail: 1349.99, payout: 1350, createdAt: '2026-11-23T10:00:00Z' },
          { id: '3', name: 'Seen Yesterday', retail: 100, payout: 300, createdAt: null, firstSeenAt: '2026-11-22T10:00:00Z' },
          { id: '4', name: 'No Date', retail: 100, payout: 500 },
        ],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByLabelText('Sort deals')).toHaveValue('updated_desc');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.cells[0].textContent.replace(/History$/, ''))).toEqual(['Newest Posted', 'Seen Yesterday', 'Oldest', 'No Date']);
  });

  it('sorts by highest profit when chosen', () => {
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

    fireEvent.change(screen.getByLabelText('Sort deals'), { target: { value: 'profit_desc' } });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Biggest Profit');
    expect(rows[1]).toHaveTextContent('Biggest Payout');
  });

  it('sorts by highest ROI and filters by a minimum ROI, counting the best card', () => {
    currentPaymentMethods = [{ id: 'flat', name: 'Flat 2%', default_cashback_rate: 2, category_rates: [] }];
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Big Dollars', retail: 1000, payout: 1040 }, // +$40, 4% (6% with card)
          { id: '2', name: 'Big Percent', retail: 100, payout: 115 }, // +$15, 15% (17%)
          { id: '3', name: 'Thin Deal', retail: 200, payout: 202 }, // 1% (3%)
          { id: '4', name: 'No Retail Deal', retail: null, payout: 50 },
        ],
      }],
    };
    render(<MemoryRouter><Cashout /></MemoryRouter>);
    const names = () => screen.getAllByRole('row').slice(1).map((row) => row.cells[0].textContent.replace(/History$/, ''));

    fireEvent.change(screen.getByLabelText('Sort deals'), { target: { value: 'roi_desc' } });
    expect(names().map((name) => name.match(/Big Percent|Big Dollars|Thin Deal|No Retail Deal/)[0])).toEqual(['Big Percent', 'Big Dollars', 'Thin Deal', 'No Retail Deal']);

    // 5%+: the card's 2% lifts Big Dollars to 6%; Thin Deal (3%) and the unpriced deal drop out.
    fireEvent.change(screen.getByLabelText('Filter by minimum ROI'), { target: { value: '5' } });
    expect(names()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Filter by minimum ROI'), { target: { value: '15' } });
    expect(names()).toHaveLength(1);
    expect(names()[0]).toContain('Big Percent');
    fireEvent.change(screen.getByLabelText('Filter by minimum ROI'), { target: { value: 'any' } });
    expect(names()).toHaveLength(4);
  });

  it('shows how many you have bought against the limit of a deal', () => {
    const row = (status, quantity, dealId = '1') => ({ id: `${status}-${quantity}-${dealId}`, status, quantity, connection_id: mockConnections[0].id, external_deal_id: dealId, external_item_id: 'i1', open_item_id: 'i1', tracking_codes: [], created_at: new Date().toISOString() });
    currentCommitments = [row('active', 1), row('pending', 1), row('withdrawn', 3), row('active', 2, '2')];
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Part Bought', retail: 100, payout: 110, items: [{ id: 'i1', name: 'Part Bought', vendorLimit: 3 }] },
          { id: '2', name: 'Maxed Out', retail: 100, payout: 110, items: [{ id: 'i1', name: 'Maxed Out', vendorLimit: 2 }] },
          { id: '3', name: 'Untouched', retail: 100, payout: 110, items: [{ id: 'i1', name: 'Untouched', vendorLimit: 4 }] },
        ],
      }],
    };
    render(<MemoryRouter><Cashout /></MemoryRouter>);
    const rowOf = (name) => screen.getByText(name).closest('tr');
    expect(rowOf('Part Bought')).toHaveTextContent('2 of 3 bought');
    expect(rowOf('Part Bought')).not.toHaveTextContent('limit reached');
    expect(rowOf('Maxed Out')).toHaveTextContent('2 of 2 bought · limit reached');
    expect(rowOf('Untouched')).toHaveTextContent('Limit 4');
    expect(rowOf('Untouched')).not.toHaveTextContent('bought');
  });

  it('estimates profit as payout minus retail, to the cent', () => {
    expect(estimateDealProfit({ payout: 1140, retail: 899.99 })).toEqual({ amount: 240.01, pct: 26.67 });
    expect(estimateDealProfit({ payout: 16, retail: 14.99 })).toEqual({ amount: 1.01, pct: 6.74 });
    expect(estimateDealProfit({ payout: 35, retail: 40 })).toEqual({ amount: -5, pct: -12.5 });
    expect(estimateDealProfit({ payout: 119, retail: 119 })).toEqual({ amount: 0, pct: 0 });
  });

  it('shows no gain or loss for an even deal or one that rounds to nothing', () => {
    expect(formatDealProfit({ amount: 240.01, pct: 26.67 })).toEqual({ amount: '+$240.01', pct: '+26.67%', tone: 'gain' });
    expect(formatDealProfit({ amount: -5, pct: -12.5 })).toEqual({ amount: '-$5.00', pct: '-12.5%', tone: 'loss' });
    expect(formatDealProfit({ amount: 0, pct: 0 })).toEqual({ amount: '$0.00', pct: '0%', tone: 'neutral' });
    expect(formatDealProfit({ amount: 0.01, pct: 0 })).toEqual({ amount: '+$0.01', pct: '~0%', tone: 'neutral' });
    expect(formatDealProfit({ amount: -0.01, pct: 0 })).toEqual({ amount: '-$0.01', pct: '~0%', tone: 'neutral' });
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
      ['Deal / Item', 'Cashout', 'Payout', 'Retail', 'Est. Profitbefore tax', 'Best Cardprofit with rewards', 'Expires', 'Buy At', 'Actions'],
    );
    expect(gainRowButton()).toBeEnabled();
    const gainRow = screen.getByText('Gain Deal').closest('tr');
    expect(gainRow.cells[2]).toHaveTextContent('$1,140.00');
    expect(gainRow.cells[3]).toHaveTextContent('$899.99');
    expect(screen.getByText('No Retail Deal').closest('tr').cells[3]).toHaveTextContent('—');

    expect(screen.getByText('Est. Profit')).toBeInTheDocument();
    expect(screen.getByText('+$240.01')).toBeInTheDocument();
    expect(screen.getByText('+26.67% ROI')).toBeInTheDocument();
    expect(screen.getByText('-$5.00')).toBeInTheDocument();
    expect(screen.getByText('-12.5% ROI')).toBeInTheDocument();
    expect(screen.getByText('No Retail Deal').closest('tr')).toHaveTextContent('—');
    expect(screen.getByText('No Retail Deal').closest('tr')).not.toHaveTextContent('ROI');
  });

  it('shows the ROI in card view too, and none for a deal with no retail price', () => {
    localStorage.setItem('cashoutViewMode', 'card');
    currentPaymentMethods = [{ id: 'flat', name: 'Flat 2%', default_cashback_rate: 2, category_rates: [] }];
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [
          { id: '1', name: 'Gain Deal', retail: 200, payout: 220 },
          { id: '3', name: 'No Retail Deal', retail: null, payout: 50 },
        ],
      }],
    };
    render(<MemoryRouter><Cashout /></MemoryRouter>);
    const gain = screen.getByText('Gain Deal').closest('article');
    expect(within(gain).getByText('+10% ROI')).toBeInTheDocument();
    // with the 2% card: $20 + $4 on $200
    expect(within(gain).getByText('+12% ROI')).toBeInTheDocument();
    expect(screen.getByText('No Retail Deal').closest('article')).not.toHaveTextContent('ROI');
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
    const names = () => screen.getAllByRole('row').slice(1).map((row) => row.cells[0].textContent.replace(/History$/, ''));
    const category = screen.getByLabelText('Filter by category');

    expect(category).toHaveValue('all');
    expect(names()).toHaveLength(4);

    fireEvent.change(category, { target: { value: 'above_retail' } });
    expect(names()).toEqual(['Above Deal']);

    fireEvent.change(category, { target: { value: 'close_to_retail' } });
    expect(names().sort()).toEqual(['Below Deal', 'Equal Deal']);

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
        note: '',
        address: 'CSG LLC\n202 Carson Dr\nBear, DE 19701',
        deliverTo: 'Delaware Only',
        coupon: 'IDEA3FLASH',
      });
    });

    it('handles notes with only an address, or with neither', () => {
      expect(parseDealNotes('📌 Dropship To:\nCSG LLC\n202 Carson Dr')).toEqual({ note: '', address: 'CSG LLC\n202 Carson Dr', deliverTo: null, coupon: null });
      expect(parseDealNotes('Deal Extended\nPrice Match Available')).toEqual({ note: 'Deal Extended Price Match Available', address: null, deliverTo: null, coupon: null });
      expect(parseDealNotes(null)).toEqual({ note: '', address: null, deliverTo: null, coupon: null });
    });

    it('keeps note lines that come after the address block', () => {
      expect(parseDealNotes('Dropship To:\nCSG LLC\n\nCall first')).toEqual({ note: 'Call first', address: 'CSG LLC', deliverTo: null, coupon: null });
    });

    it('keeps what a coupon line says after the code', () => {
      expect(parseDealNotes('Use Code: SELECT4K to get $14.99')).toMatchObject({ coupon: 'SELECT4K', note: 'To get $14.99' });
      expect(parseDealNotes('Coupon applied at checkout')).toMatchObject({ coupon: null, note: 'Coupon applied at checkout' });
    });

    it('opens a long note and closes it again', () => {
      const note = 'Minimum Price Guarantee (We will aim to raise prices after release)';
      currentDeals = { results: [{ connection: mockConnections[0], deals: [{ id: '1', name: 'Deal', payout: 10, notes: note }] }] };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      const more = screen.getByRole('button', { name: 'More' });
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText(note)).toHaveClass('line-clamp-1');

      fireEvent.click(more);
      expect(screen.getByRole('button', { name: 'Less' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText(note)).not.toHaveClass('line-clamp-1');
    });

    it('offers no More button on a note that fits', () => {
      currentDeals = { results: [{ connection: mockConnections[0], deals: [{ id: '1', name: 'Deal', payout: 10, notes: 'Price Match Available' }] }] };
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      expect(screen.getByText('Price Match Available')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
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
      expect(screen.queryByText('Use Code: IDEA3FLASH')).not.toBeInTheDocument();
      expect(screen.queryByText(/Carson Dr/)).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy Address' }));
      });

      expect(writeText).toHaveBeenCalledWith('CSG LLC\n202 Carson Dr\nBear, DE 19701');
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy code IDEA3FLASH' }));
      });
      expect(writeText).toHaveBeenCalledWith('IDEA3FLASH');
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
      fireEvent.change(screen.getByLabelText('Sort deals'), { target: { value: 'profit_desc' } });
      expect(names()).toEqual(['Both Deal', 'Amazon Deal', 'Open Deal']);
      expect(screen.getByText('Live Deals').nextSibling).toHaveTextContent('3');

      fireEvent.click(screen.getByLabelText('Show expired (1)'));

      expect(names()).toContain('Expired Deal');
      expect(screen.getByText('Live Deals').nextSibling).toHaveTextContent('3');
    });

    it('puts expired deals last whatever the sort, with no way to buy', () => {
      fireEvent.click(screen.getByLabelText('Show expired (1)'));

      // Its $50 estimate would otherwise sort first.
      expect(names().at(-1)).toBe('Expired Deal');
      fireEvent.change(screen.getByLabelText('Sort deals'), { target: { value: 'ending_soon' } });
      expect(names().at(-1)).toBe('Expired Deal');

      const row = screen.getByText('Expired Deal').closest('tr');
      expect(row).toHaveClass('opacity-60');
      expect(row.querySelector('a')).toBeNull();
      expect(within(row).queryByRole('button', { name: 'Log Purchase' })).not.toBeInTheDocument();
      expect(within(row).getByText('+$50.00')).not.toHaveClass('text-emerald-400');
    });

    it('filters to one store, including deals sold at several', () => {
      const store = screen.getByLabelText('Filter by store');
      expect(within(store).getAllByRole('option').map((o) => o.textContent)).toEqual(['All Stores', 'Amazon', 'Target', 'Walmart']);

      fireEvent.change(store, { target: { value: 'Amazon' } });
      expect(names().sort()).toEqual(['Amazon Deal', 'Both Deal']);
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

      expect(screen.queryByText('See Cashout Deals Now')).not.toBeInTheDocument();
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

  describe('view toggle', () => {
    it('defaults to the table, with the toggle hidden once the screen forces cards', () => {
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Table view' })).toHaveAttribute('aria-pressed', 'true');

      window.matchMedia = (query) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() });
      cleanup();
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );
      expect(screen.queryByRole('button', { name: 'Table view' })).not.toBeInTheDocument();
    });

    it('switches to cards on click, and remembers the choice on the next visit', () => {
      const { unmount } = render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Card view' }));
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getAllByRole('article').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Card view' })).toHaveAttribute('aria-pressed', 'true');
      unmount();

      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Card view' })).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });

  it('shows cards instead of the table on screens too narrow for it', () => {
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
    expect(card).toHaveTextContent('before tax');
    expect(card).toHaveTextContent('EB Primary');
    expect(within(card).getByRole('link', { name: 'Buy at Amazon' })).toBeInTheDocument();
  });

  it('keeps an expired card with its cashout marked Expired, but no buy links or Log Purchase', () => {
    window.matchMedia = (query) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [{
          id: '1',
          name: 'Expired Deal',
          retail: 50,
          payout: 40,
          expiresAt: new Date(Date.now() - 86400000).toISOString(),
          items: [{ name: 'Expired Deal', purchaseLinks: [{ name: 'Amazon', url: 'https://www.amazon.com/dp/1' }] }],
        }],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText('Show expired (1)'));
    const card = screen.getByRole('article');
    expect(card).toHaveClass('opacity-60');
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Log Purchase' })).not.toBeInTheDocument();
    expect(within(card).getByText('EB Primary')).toBeInTheDocument();
    expect(within(card).getByText('Expired')).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Sort deals'), { target: { value: 'profit_desc' } });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => row.cells[0].textContent.replace(/History$/, ''))).toEqual([
      'Small Payout Big Profit',
      'Biggest Payout Small Profit',
      'Loss Deal',
      'No Retail Deal',
    ]);
  });

  it('names the search and filter controls', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByLabelText('Filter by cashout')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search deals'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByLabelText('Search deals')).toHaveValue('');
  });

  it('links straight to Data Setup instead of opening its own connections modal', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const manageLink = screen.getByRole('link', { name: /Manage Cashouts/i });
    expect(manageLink).toHaveAttribute('href', '/settings');
    expect(manageLink).toHaveTextContent('1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected Cashout Services')).not.toBeInTheDocument();
  });

  it('points the attention banner at Data Setup instead of a modal', () => {
    currentDeals = {
      results: [{
        connection: { ...mockConnections[0], status: 'attention_needed', lastError: 'ElectronicsBuyer API key is invalid or revoked.' },
        deals: [],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const reviewLink = screen.getByRole('link', { name: 'Review in Data Setup' });
    expect(reviewLink).toHaveAttribute('href', '/settings');
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

  describe('Log Purchase', () => {
    beforeEach(() => {
      currentDeals = {
        results: [{
          connection: mockConnections[0],
          deals: [{
            id: '5213', name: 'PS5 Pro', retail: 899.99, payout: 1140,
            items: [{ id: '10001', name: 'PS5 Pro' }],
          }],
        }],
      };
    });

    describe('buying more of an item already committed', () => {
      const committed = (status, quantity) => ({
        id: `c-${status}`, status, quantity, connection_id: 'conn-1', external_deal_id: '5213', external_item_id: '10001', open_item_id: '10001',
        tracking_codes: [], created_at: new Date().toISOString(), connection: { display_name: 'EB Primary' },
      });
      const openForm = () => {
        render(<MemoryRouter><Cashout /></MemoryRouter>);
        fireEvent.click(screen.getAllByRole('button', { name: 'Log Purchase' })[0]);
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
        fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      };
      const submit = () => act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: /Log Purchase/ }).find((b) => b.type === 'submit'));
      });

      it('says the purchase is added to the existing commitment when it ships', async () => {
        currentCommitments = [committed('active', 2), committed('pending', 1)];
        openForm();
        fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
        expect(screen.getByTestId('adds-to-commitment')).toHaveTextContent(
          'You already have 2 committed for this item and 1 waiting to ship. This is logged as its own purchase, and its 2 are added to that commitment when it ships.',
        );
        mockMutations.logPurchase.mutateAsync.mockResolvedValueOnce({ commitPending: true, addsToCommitment: true });
        await submit();
        expect(toast.success).toHaveBeenCalledWith('Logged as its own purchase. Not committed to EB Primary yet.', expect.objectContaining({
          description: expect.stringMatching(/added to your commitment/),
        }));
      });

      it('says nothing extra for an item with no commitment', () => {
        currentCommitments = [];
        openForm();
        expect(screen.queryByTestId('adds-to-commitment')).not.toBeInTheDocument();
      });

      it('confirms the new total before raising, and reports it', async () => {
        currentCommitments = [committed('active', 2)];
        openForm();
        fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' })); });
        expect(screen.getByRole('heading', { name: 'Add to your commitment?' })).toBeInTheDocument();
        expect(screen.getByText(/raises your binding commitment with EB Primary for this item from 2 to 3/)).toBeInTheDocument();
        mockMutations.logPurchase.mutateAsync.mockResolvedValueOnce({ addedTo: 3, trackingSubmitted: true });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit' })); });
        expect(toast.success).toHaveBeenCalledWith('Logged and added to your commitment: now 3 with EB Primary.', expect.anything());
      });

      it('warns when it was saved but the cashout refused to commit it', async () => {
        currentCommitments = [committed('active', 2)];
        openForm();
        fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' })); });
        mockMutations.logPurchase.mutateAsync.mockResolvedValueOnce({ commitError: 'EB Primary would not add these 1. Contact EB Primary.', commitPending: true });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit' })); });
        expect(toast.warning).toHaveBeenCalledWith('Logged, but not committed to EB Primary.', expect.objectContaining({ description: 'EB Primary would not add these 1. Contact EB Primary.' }));
      });
    });

    describe('store account', () => {
      beforeEach(() => {
        currentPlatforms = [
          { id: 'vendor-1', name: 'Amazon', type: 'Vendor', accounts: [
            { id: 'acct-main', name: 'Main', email: 'main@example.com', status: 'Active' },
            { id: 'acct-biz', name: 'Business', username: 'biz', status: 'Suspended' },
          ] },
          { id: 'vendor-2', name: 'Walmart', type: 'Vendor', accounts: [] },
          ...defaultPlatforms.filter((p) => p.type === 'Cashout'),
        ];
      });
      const open = () => {
        render(<MemoryRouter><Cashout /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
        fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      };
      const submit = () => act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: /Log Purchase/ }).find((b) => b.type === 'submit'));
      });

      it('shows the account picker only for a store with accounts', () => {
        open();
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-2' } });
        expect(screen.queryByLabelText('Account (optional)')).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
        const picker = screen.getByLabelText('Account (optional)');
        expect(picker).toHaveValue('');
        expect(within(picker).getByRole('option', { name: 'Main (main@example.com)' })).toBeInTheDocument();
        expect(within(picker).getByRole('option', { name: 'Business (biz) · Suspended' })).toBeInTheDocument();
      });

      it('sends the picked account with the purchase', async () => {
        open();
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
        fireEvent.change(screen.getByLabelText('Account (optional)'), { target: { value: 'acct-biz' } });
        await submit();
        expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
          vendor_id: 'vendor-1', account_id: 'acct-biz',
        }));
      });

      it('sends no account when none is picked, or after switching stores', async () => {
        open();
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
        fireEvent.change(screen.getByLabelText('Account (optional)'), { target: { value: 'acct-main' } });
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-2' } });
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
        expect(screen.getByLabelText('Account (optional)')).toHaveValue('');
        await submit();
        const sent = mockMutations.logPurchase.mutateAsync.mock.calls[0][0];
        expect(sent.vendor_id).toBe('vendor-1');
        expect(sent.account_id).toBeUndefined();
      });

      describe('with earlier purchases of this item', () => {
        const bought = (id, quantity, accountId, name, vendorId = 'vendor-1') => ({
          id, status: 'active', quantity, connection_id: 'conn-1', external_deal_id: '5213', external_item_id: '10001', open_item_id: '10001',
          tracking_codes: ['1Z'], created_at: new Date().toISOString(), connection: { display_name: 'EB Primary' },
          sale: { inventory: { vendor_id: vendorId, account_id: accountId, account: accountId ? { name } : null } },
        });

        it('preselects the last account used at the store, and lists what each account already bought', () => {
          currentCommitments = [bought('n', 2, 'acct-biz', 'Business'), bought('o', 1, 'acct-main', 'Main'), bought('p', 1, null)];
          open();
          fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
          expect(screen.getByLabelText('Account (optional)')).toHaveValue('acct-biz');
          expect(screen.getByText('Your last account at this store.')).toBeInTheDocument();
          expect(screen.getByText('Already bought: Business 2 · Main 1')).toBeInTheDocument();
          // Picking "No account" sticks, and the hint goes.
          fireEvent.change(screen.getByLabelText('Account (optional)'), { target: { value: '' } });
          expect(screen.getByLabelText('Account (optional)')).toHaveValue('');
          expect(screen.queryByText('Your last account at this store.')).not.toBeInTheDocument();
        });

        it("doesn't preselect an account from another store", () => {
          currentCommitments = [bought('n', 2, 'acct-other', 'Other', 'vendor-2')];
          open();
          fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
          expect(screen.getByLabelText('Account (optional)')).toHaveValue('');
        });

        it('shows the account on the commit confirmation', async () => {
          currentCommitments = [bought('n', 2, 'acct-biz', 'Business')];
          open();
          fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
          fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });
          await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' })); });
          expect(screen.getByText('Account')).toBeInTheDocument();
          expect(screen.getByText('Business')).toBeInTheDocument();
        });
      });
    });

    describe('a deal with one item per color', () => {
      beforeEach(() => {
        currentDeals.results[0].deals[0] = {
          id: '6000', name: 'iPad Air 11', retail: 599, payout: 640,
          items: [
            { id: '201', name: 'iPad Air 11 128GB - Blue', upcs: ['195949000001'], remainingPercentage: 72, vendorLimit: 2 },
            { id: '202', name: 'iPad Air 11 128GB - Purple', upcs: ['195949000002'], remainingPercentage: 40 },
          ],
        };
      });

      const openForm = () => {
        render(<MemoryRouter><Cashout /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
        fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
        fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      };
      const submitForm = () => act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: /Log Purchase/ }).find((b) => b.type === 'submit'));
      });

      it('starts with no color picked and will not save until one is', async () => {
        openForm();
        const picker = screen.getByLabelText('Which item (color, size or model)');
        expect(picker).toHaveValue('');
        expect(screen.getByRole('option', { name: 'iPad Air 11 128GB - Blue · UPC 195949000001' })).toBeInTheDocument();

        await submitForm();

        expect(mockMutations.logPurchase.mutateAsync).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Pick the exact item you bought (color, size or model).');
      });

      it('sends the picked color and shows what EB says about it', async () => {
        mockMutations.logPurchase.mutateAsync.mockResolvedValueOnce({ commitPending: true });
        openForm();
        fireEvent.change(screen.getByLabelText('Which item (color, size or model)'), { target: { value: '202' } });

        expect(screen.getByText('UPC 195949000002 · 40% of the limit left')).toBeInTheDocument();
        await submitForm();

        expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
          item_id: '202', item_name: 'iPad Air 11 128GB - Purple',
        }));
      });

      it('names the color on the confirm screen before committing', async () => {
        openForm();
        fireEvent.change(screen.getByLabelText('Which item (color, size or model)'), { target: { value: '201' } });
        fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' }));
        });

        expect(screen.getByText('iPad Air 11 128GB - Blue')).toBeInTheDocument();
        expect(screen.getByText(/One of 2 items in this deal/)).toBeInTheDocument();
        expect(mockMutations.logPurchase.mutateAsync).not.toHaveBeenCalled();
      });
    });

    it('picks the only item of a single-item deal for you', () => {
      render(<MemoryRouter><Cashout /></MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      expect(screen.queryByLabelText('Which item (color, size or model)')).not.toBeInTheDocument();
    });

    it("uses the card's store rate for cashback, like Add Transaction", async () => {
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-amazon' } });
      fireEvent.change(screen.getByLabelText('Unit cost (what you paid)'), { target: { value: '15.99' } });
      fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
      fireEvent.change(screen.getByLabelText('Sales tax'), { target: { value: '2.02' } });

      // 5% of (15.99 x 2 + 2.02) = 5% of 34.00
      expect(screen.getByText('$1.70 (5%)')).toBeInTheDocument();

      const dialogSubmit = screen.getAllByRole('button', { name: 'Log Purchase' }).find((b) => b.type === 'submit');
      await act(async () => {
        fireEvent.click(dialogSubmit);
      });
      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        payment_method_id: 'card-amazon', cashback_rate: 5, cashback_earned: 1.7,
      }));
    });

    it('falls back to the card default away from its bonus store', async () => {
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      fireEvent.change(screen.getByLabelText('Store'), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-amazon' } });
      expect(screen.getByText(/\(1%\)/)).toBeInTheDocument();
    });

    it('logs without committing when there is no tracking number yet', async () => {
      mockMutations.logPurchase.mutateAsync.mockResolvedValueOnce({ commitPending: true });
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      expect(screen.getByRole('heading', { name: 'Log Purchase' })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      expect(screen.getByText(/without committing to EB Primary/)).toBeInTheDocument();
      expect(screen.queryByText(/real, binding pledge/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Insured value/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Commit & Log Purchase' })).not.toBeInTheDocument();

      // The dialog's own button (the deal row's Log Purchase opened it).
      const dialogSubmit = screen.getAllByRole('button', { name: 'Log Purchase' }).find((b) => b.type === 'submit');
      await act(async () => {
        fireEvent.click(dialogSubmit);
      });

      // No confirm screen: nothing binding is sent.
      expect(screen.queryByRole('heading', { name: 'Commit to this deal?' })).not.toBeInTheDocument();
      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        tracking_codes: [], vendor_id: 'vendor-1', payment_method_id: 'card-1',
      }));
      expect(mockMutations.logPurchase.mutateAsync.mock.calls[0][0].insured_value).toBeUndefined();
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Not committed to EB Primary yet'), expect.anything());
      expect(screen.queryByRole('heading', { name: 'Log Purchase' })).not.toBeInTheDocument();
    });

    it('asks to confirm, then commits, logs the purchase, and reports a successful tracking submission', async () => {
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' }));
      });

      // Nothing is sent yet: the confirm screen shows what's about to be committed.
      expect(mockMutations.logPurchase.mutateAsync).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'Commit to this deal?' })).toBeInTheDocument();
      expect(screen.getByText(/real, binding pledge/)).toBeInTheDocument();
      expect(screen.getByText('$1,140.00 each, $1,140.00 total')).toBeInTheDocument();
      expect(screen.getByText('1Z999AA10123456784')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus());

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
      });

      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        connectionId: 'conn-1',
        deal_id: '5213',
        item_id: '10001',
        quantity: 1,
        tracking_codes: ['1Z999AA10123456784'],
        vendor_id: 'vendor-1',
        payment_method_id: 'card-1',
        unit_payout: 1140,
        platform_id: 'group-eb', // no group linked: picked by name in the form
      }));
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Committed'));
      expect(screen.queryByRole('heading', { name: 'Log Purchase' })).not.toBeInTheDocument();
    });

    it('shows the server\'s real rejection reason without closing the form', async () => {
      mockMutations.logPurchase.mutateAsync.mockRejectedValueOnce(new Error('This deal has expired.'));
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
      });

      expect(screen.getByRole('alert')).toHaveTextContent('This deal has expired.');
      expect(screen.getByRole('heading', { name: 'Log Purchase' })).toBeInTheDocument();
      expect(screen.getByLabelText('Tracking number')).toHaveValue('1Z999AA10123456784');
    });

    it('goes back to the form from the confirm screen without committing', async () => {
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' }));
      });
      expect(screen.getByText('$1,140.00 each, $3,420.00 total')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(screen.getByRole('heading', { name: 'Log Purchase' })).toBeInTheDocument();
      expect(screen.getByLabelText('Quantity')).toHaveValue(3);
      expect(screen.getByLabelText('Tracking number')).toHaveValue('1Z999AA10123456784');
      expect(mockMutations.logPurchase.mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('Log Purchase for Points4Days', () => {
    const p4dConnection = { ...mockConnections[0], id: 'conn-p4d', provider: 'p4d', displayName: null, platformId: null };
    beforeEach(() => {
      currentProviders = [...mockProviders, { id: 'p4d', name: 'Points4Days', credentialType: 'login', supportsCommits: false }];
      currentDeals = {
        results: [{
          connection: p4dConnection,
          deals: [{ id: 'p1', name: 'PS5 Pro', payout: 1222, retail: 899.99, dealUrl: 'https://www.points4days.com/f/x', items: [{ id: '9', name: 'PS5 Pro' }] }],
        }],
      };
    });
    const openForm = () => {
      render(<MemoryRouter><Cashout /></MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));
      fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
    };

    it.each([
      ['p4d', 'Points4Days', 'https://www.points4days.com/f/x'],
      ['la', 'LA', 'https://www.earnfrombuying.com'],
    ])('saves without a tracking number, then says to commit and links to the cashout (%s)', async (id, name, dealUrl) => {
      currentProviders = [...mockProviders, { id, name, credentialType: 'login', supportsCommits: false }];
      currentDeals.results[0].connection = { ...p4dConnection, provider: id, platformId: 'group-p4d' };
      currentDeals.results[0].deals[0].dealUrl = dealUrl;
      openForm();
      expect(screen.getByLabelText('Tracking number')).toHaveAttribute('placeholder', 'Blank if it hasn’t shipped yet');
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Log Purchase' }).at(-1)); // the form's own button
      });

      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ deal_id: 'p1', tracking_codes: [] }));
      const dialog = within(screen.getByRole('dialog', { name: `Make sure to commit to ${name}` }));
      expect(dialog.getByText(/When it ships, send them the tracking number/)).toBeInTheDocument();
      expect(dialog.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
      const link = dialog.getByRole('link', { name: `Go to ${name}` });
      expect(link).toHaveAttribute('href', dealUrl);
      expect(link).toHaveAttribute('target', '_blank');
      await waitFor(() => expect(link).toHaveFocus());
    });

    it('shows the server error in the form and no commit reminder when the save fails', async () => {
      mockMutations.logPurchase.mutateAsync.mockRejectedValueOnce(new Error('Store is required.'));
      openForm();
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Log Purchase' }).at(-1));
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Store is required.');
      expect(screen.queryByRole('heading', { name: /Make sure to commit/ })).not.toBeInTheDocument();
    });

    it('with a tracking number, says it does not commit, and sells to the matching group', async () => {
      openForm();
      expect(screen.getByText(/doesn't commit or send tracking to Points4Days/)).toBeInTheDocument();
      expect(screen.getByLabelText('Sold to')).toHaveValue('group-p4d');
      expect(screen.queryByLabelText(/Insured value/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: ' 1Z999AA10123456784 ' } });
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Log Purchase' }).at(-1));
      });

      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        connectionId: 'conn-p4d',
        deal_id: 'p1',
        tracking_codes: ['1Z999AA10123456784'],
        insured_value: undefined,
        unit_payout: 1222,
        platform_id: 'group-p4d',
      }));
      // No confirm step for Points4Days: it saves, then says to commit on their site.
      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('heading', { name: 'Make sure to commit to Points4Days' })).toBeInTheDocument();
      expect(screen.getByText(/doesn't know about them yet/)).toBeInTheDocument();
      expect(screen.getByText('1Z999AA10123456784')).toBeInTheDocument();
      const open = within(screen.getByRole('dialog')).getByRole('link', { name: /Go to Points4Days/ });
      expect(open).toHaveAttribute('href', 'https://www.points4days.com/f/x');
      await waitFor(() => expect(open).toHaveFocus());

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('heading', { name: /Make sure to commit/ })).not.toBeInTheDocument();
    });

    it('asks which group the sale goes to when none matches', async () => {
      openForm();
      fireEvent.change(screen.getByLabelText('Sold to'), { target: { value: '' } });
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Log Purchase' }).at(-1));
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Pick which cashout group');
      expect(mockMutations.logPurchase.mutateAsync).not.toHaveBeenCalled();
    });

    it('does not ask for a group when the connection already has one', () => {
      currentDeals.results[0].connection = { ...p4dConnection, platformId: 'group-p4d' };
      openForm();
      expect(screen.queryByLabelText('Sold to')).not.toBeInTheDocument();
    });
  });

  describe('Commitments', () => {
    it('shows the active commitment count and toggles the panel', () => {
      currentCommitments = [
        { id: 'c1', status: 'active', external_deal_id: '5232', external_item_id: '1', quantity: 2, tracking_codes: [], created_at: new Date().toISOString(), connection: { display_name: 'EB Primary' } },
        { id: 'c2', status: 'withdrawn', external_deal_id: '5232', external_item_id: '2', quantity: 1, tracking_codes: [], created_at: new Date().toISOString(), connection: { display_name: 'EB Primary' } },
      ];
      render(
        <MemoryRouter>
          <Cashout />
        </MemoryRouter>
      );

      const toggle = screen.getByRole('tab', { name: /Commitments/i });
      expect(toggle).toHaveTextContent('1'); // only the active one counts

      expect(screen.queryByText('Withdraw')).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(screen.getAllByText('Airpod 5 ANC').length).toBeGreaterThan(0); // c1/c2 resolved from the live deal list
      expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1); // only the active one
    });

    it('offers Send tracking only when the cashout lacks the sale\'s tracking number', () => {
      const base = { status: 'active', external_deal_id: '5232', external_item_id: '1', quantity: 1, created_at: new Date().toISOString(), connection: { display_name: 'EB Primary' } };
      currentCommitments = [
        { ...base, id: 'sent', tracking_codes: ['1ZSAME'], sale: { tracking_number: '1zsame' } },
        { ...base, id: 'changed', external_item_id: '2', tracking_codes: ['1ZOLD'], sale: { tracking_number: '1ZNEW' } },
        { ...base, id: 'failed', external_item_id: '3', tracking_codes: [], tracking_error: 'EB is down', sale: { tracking_number: '1ZFAIL' } },
        { ...base, id: 'none', external_item_id: '4', tracking_codes: [], sale: { tracking_number: null } },
      ];
      const seen = vi.fn();
      window.addEventListener('cashout-tracking-send', seen);
      render(<MemoryRouter><Cashout /></MemoryRouter>);
      fireEvent.click(screen.getByRole('tab', { name: /Commitments/i }));

      const buttons = screen.getAllByRole('button', { name: 'Send tracking' });
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[0]);
      expect(seen.mock.calls[0][0].detail).toEqual({ commitment_id: 'changed', tracking_number: '1ZNEW', cashout: 'EB Primary', account: null });
      window.removeEventListener('cashout-tracking-send', seen);
    });

    describe('several purchases of one item', () => {
      const row = (id, status, quantity, extra = {}) => ({
        id, status, quantity, connection_id: 'conn-1', external_deal_id: '5232', external_item_id: '1', open_item_id: '1',
        external_commitment_id: status === 'active' ? 'eb-1' : null, tracking_codes: status === 'active' ? [`1Z${id}`] : [],
        created_at: new Date().toISOString(), connection: { display_name: 'EB Primary' },
        sale: { tracking_number: status === 'active' ? `1Z${id}` : null, unit_price: 119, inventory: { product_name: 'Airpod 5 ANC', unit_purchase_cost: 99, account: { name: `Acct ${id}` } } },
        ...extra,
      });
      const openPanel = () => {
        render(<MemoryRouter><Cashout /></MemoryRouter>);
        fireEvent.click(screen.getByRole('tab', { name: /Commitments/i }));
      };

      it('splits Not committed from Committed, with one row per committed item opening to each purchase', () => {
        currentCommitments = [row('a', 'active', 2), row('b', 'active', 2), row('c', 'pending', 1), row('w', 'withdrawn', 1, { open_item_id: null })];
        openPanel();
        const headings = screen.getAllByRole('rowheader').map((h) => h.textContent);
        expect(headings[0]).toMatch(/^Not committed1/);
        expect(headings[1]).toMatch(/^Committed1/);
        expect(headings[2]).toMatch(/^Withdrawn1/);
        // The waiting purchase is on its own, above, saying it adds to the 4.
        expect(screen.getByText('Acct c')).toBeInTheDocument();
        expect(screen.getByText('Adds to your 4 committed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
        // The committed ones are one row with the total.
        expect(screen.getByText('4 committed')).toBeInTheDocument();
        expect(screen.queryByText(/Acct a/)).not.toBeInTheDocument();
        expect(screen.getByText('2 accounts')).toHaveAttribute('title', 'Acct a, Acct b');
        fireEvent.click(screen.getByRole('button', { name: '2 purchases' }));
        expect(screen.getAllByText(/^Qty 2 · /)).toHaveLength(2);
        expect(screen.getByText('Acct a')).toBeInTheDocument();
        expect(screen.getByText('Acct b')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Take off' })).toHaveLength(2);
      });

      it('shows an Account column after Cashout, rolled up for a group', () => {
        const acct = (name) => ({ sale: { tracking_number: null, unit_price: 119, inventory: { product_name: 'Airpod 5 ANC', unit_purchase_cost: 99, account: name ? { name } : null } } });
        currentCommitments = [
          row('a', 'active', 2, { sale: { tracking_number: '1Za', unit_price: 119, inventory: { product_name: 'Airpod 5 ANC', account: { name: 'Bizz' } } } }),
          row('b', 'active', 1, { sale: { tracking_number: '1Zb', unit_price: 119, inventory: { product_name: 'Airpod 5 ANC', account: { name: 'Bizz' } } } }),
          row('c', 'pending', 1, { connection_id: 'conn-2', ...acct(null) }),
        ];
        openPanel();
        const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
        expect(headers.slice(0, 3)).toEqual(['Item', 'Cashout', 'Account']);
        // Every purchase in the group is on Bizz, so the group shows Bizz.
        expect(screen.getByText('Bizz')).toHaveAttribute('title', 'Bizz');
        // A purchase with no account shows a quiet dash, not text.
        expect(screen.getAllByTitle('No account').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole('button', { name: '2 purchases' }));
        expect(screen.getAllByText('Bizz')).toHaveLength(3);
      });

      it('shows the account on phone cards, with Mixed for one account plus none', () => {
        window.matchMedia = (query) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() });
        currentCommitments = [
          row('a', 'active', 2, { sale: { tracking_number: '1Za', unit_price: 119, inventory: { product_name: 'Airpod 5 ANC', account: { name: 'Bizz' } } } }),
          row('b', 'active', 1, { sale: { tracking_number: '1Zb', unit_price: 119, inventory: { product_name: 'Airpod 5 ANC', account: null } } }),
        ];
        openPanel();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
        expect(screen.getByText('Account')).toBeInTheDocument();
        expect(screen.getByText('Mixed')).toHaveAttribute('title', 'Bizz, No account');
        fireEvent.click(screen.getByRole('button', { name: '2 purchases' }));
        expect(screen.getByText('Bizz')).toBeInTheDocument();
      });

      it('takes one purchase off (lowering the total) or withdraws everything', async () => {
        currentCommitments = [row('a', 'active', 2), row('b', 'active', 3)];
        const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockMutations.deleteCommitment.mutateAsync.mockResolvedValue({});
        openPanel();
        fireEvent.click(screen.getByRole('button', { name: '2 purchases' }));
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Take off' })[1]); });
        expect(ask.mock.calls[0][0]).toMatch(/Take these 3 \(bought on Acct b\) off your commitment\? It goes from 5 to 2/);
        expect(mockMutations.deleteCommitment.mutateAsync).toHaveBeenLastCalledWith({ id: 'b' });

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Withdraw all' })); });
        expect(ask.mock.calls[1][0]).toMatch(/Withdraw the whole commitment \(5\)/);
        expect(mockMutations.deleteCommitment.mutateAsync).toHaveBeenLastCalledWith({ id: 'a', all: true });
        ask.mockRestore();
      });

      it('adds tracking right there: saves it on the sale, which brings up the commit prompt', async () => {
        currentCommitments = [row('c', 'pending', 2, { sale_id: 'sale-c' })];
        mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sale-c', cashout_commit_pending: { commitment_id: 'c' } }), { status: 200 }));
        openPanel();
        const box = screen.getByLabelText('Tracking number');
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
        fireEvent.change(box, { target: { value: ' 1Z999AA10123456784 ' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
        expect(mockApiFetch).toHaveBeenCalledWith('/api/sales/sale-c', expect.objectContaining({
          method: 'PUT', body: JSON.stringify({ tracking_number: '1Z999AA10123456784' }),
        }));
        expect(mockInvalidate.cashouts).toHaveBeenCalled();
        // Nothing is committed from here: that's the prompt's job.
        expect(mockMutations.logPurchase.mutateAsync).not.toHaveBeenCalled();
      });

      it("refuses a tracking number the cashout wouldn't accept, without saving", async () => {
        currentCommitments = [row('c', 'pending', 1, { sale_id: 'sale-c' })];
        openPanel();
        fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z 999' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
        expect(screen.getByRole('alert')).toHaveTextContent('Letters, digits and dashes only, 24 characters at most.');
        expect(mockApiFetch).not.toHaveBeenCalled();
      });

      it('shows the save error and keeps what was typed', async () => {
        currentCommitments = [row('c', 'pending', 1, { sale_id: 'sale-c' })];
        mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Sale not found or access denied' }), { status: 404 }));
        openPanel();
        fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1ZABC' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
        expect(screen.getByRole('alert')).toHaveTextContent('Sale not found or access denied');
        expect(screen.getByLabelText('Tracking number')).toHaveValue('1ZABC');
      });

      it('has no tracking box once the purchase has tracking or is committed', () => {
        currentCommitments = [row('a', 'active', 1), row('c', 'pending', 1, { sale: { tracking_number: '1ZHAS', unit_price: 119, inventory: { product_name: 'Airpod 5 ANC' } } })];
        openPanel();
        expect(screen.queryByLabelText('Tracking number')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Commit' })).toBeInTheDocument();
      });

      it('shows why a purchase could not be committed, with Try again', () => {
        const note = "EB Primary wouldn't add these 1 to your commitment (Over the vendor limit.). This purchase is logged but not committed. Contact EB Primary about these units, or move the sale to another cashout.";
        currentCommitments = [row('a', 'active', 2), row('c', 'pending', 1, { commit_error: note, sale: { tracking_number: '1ZC', unit_price: 119, inventory: { product_name: 'Airpod 5 ANC' } } })];
        openPanel();
        expect(screen.getByRole('note')).toHaveTextContent(note);
        expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      });
    });
  });

  it('offers Log Purchase on a Points4Days deal, next to a link to the deal on its website', () => {
    currentProviders = [...mockProviders, { id: 'p4d', name: 'Points4Days', credentialType: 'login', supportsCommits: false }];
    const p4dConnection = { ...mockConnections[0], id: 'conn-p4d', provider: 'p4d', displayName: null };
    currentDeals = {
      results: [{
        connection: p4dConnection,
        deals: [{ id: '9', name: 'P4D Deal', payout: 232, retail: 179, dealUrl: 'https://www.points4days.com/p/it@deals/deal/9', items: [] }],
      }],
    };
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('button', { name: 'Log Purchase' }).length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: 'Open on Points4Days' });
    expect(links[0]).toHaveAttribute('href', 'https://www.points4days.com/p/it@deals/deal/9');
    expect(screen.getAllByText('Points4Days').length).toBeGreaterThan(0);
  });

  it('links an ElectronicsBuyer deal to the deals page on its website, like Points4Days', () => {
    currentDeals = {
      results: [{
        connection: mockConnections[0],
        deals: [{ id: '1', name: 'EB Deal', payout: 120, retail: 100, dealUrl: 'https://electronicsbuyer.gg/app/deals', items: [] }],
      }],
    };
    render(<MemoryRouter><Cashout /></MemoryRouter>);

    const link = within(screen.getByText('EB Deal').closest('tr')).getByRole('link', { name: 'Open on EB Primary' });
    expect(link).toHaveAttribute('href', 'https://electronicsbuyer.gg/app/deals');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('title', 'Open on EB Primary');
  });

  describe('Best Card column', () => {
    const amazonDeal = {
      id: 'amz', name: 'Amazon Deal', payout: 210, retail: 200,
      items: [{ id: 'i1', name: 'Amazon Deal', purchaseLinks: [{ name: 'Amazon', url: 'https://amazon.com/dp/B000000000' }] }],
    };
    const showDeals = (deals) => {
      currentDeals = { results: [{ connection: mockConnections[0], deals }] };
      render(<MemoryRouter><Cashout /></MemoryRouter>);
    };
    const bestCardCell = (name) => within(screen.getByText(name).closest('tr')).getAllByRole('cell')[5];

    it('shows the card with the best rate at the deal\'s store and the profit with its cashback', () => {
      currentPaymentMethods = [
        { id: 'flat', name: 'Flat 2%', default_cashback_rate: 2, category_rates: [] },
        { id: 'prime', name: 'Prime Visa', default_cashback_rate: 1, category_rates: [{ store: 'Amazon', rate: 5 }] },
      ];
      showDeals([amazonDeal]);

      const cell = bestCardCell('Amazon Deal');
      expect(within(cell).getByText('Prime Visa')).toBeInTheDocument();
      expect(within(cell).getByText('5% at Amazon')).toBeInTheDocument();
      // $10 deal profit + 5% of $200 retail
      expect(within(cell).getByText('+$20.00')).toBeInTheDocument();
      // ROI on what goes in: $20 on $200 retail
      expect(within(cell).getByText('+10% ROI')).toBeInTheDocument();
    });

    it('skips an expired store rate', () => {
      currentPaymentMethods = [
        { id: 'flat', name: 'Flat 2%', default_cashback_rate: 2, category_rates: [] },
        { id: 'prime', name: 'Prime Visa', default_cashback_rate: 1, category_rates: JSON.stringify([{ store: 'Amazon', rate: 5, expires: '2020-01-01' }]) },
      ];
      showDeals([amazonDeal]);

      const cell = bestCardCell('Amazon Deal');
      expect(within(cell).getByText('Flat 2%')).toBeInTheDocument();
      expect(within(cell).getByText('2% at Amazon')).toBeInTheDocument();
      expect(within(cell).getByText('+$14.00')).toBeInTheDocument();
      expect(within(cell).getByText('+7% ROI')).toBeInTheDocument();
    });

    it('links to Payment Methods when no card is saved', () => {
      currentPaymentMethods = [];
      showDeals([amazonDeal]);

      expect(within(bestCardCell('Amazon Deal')).getByRole('link', { name: 'Add a card' })).toHaveAttribute('href', '/settings');
    });

    it('shows a dash when no saved card earns anything', () => {
      currentPaymentMethods = [{ id: 'debit', name: 'Checking', default_cashback_rate: 0 }];
      showDeals([amazonDeal]);

      expect(bestCardCell('Amazon Deal')).toHaveTextContent('—');
    });
  });

  describe('same product on several cashouts', () => {
    const p4dProvider = { id: 'p4d', name: 'Points4Days', credentialType: 'login', supportsCommits: false };
    const p4dConnection = { ...mockConnections[0], id: 'conn-p4d', provider: 'p4d', displayName: null };
    const ebDeal = {
      id: 'eb-1', name: 'PS5 Pro', payout: 1140, retail: 899.99, notes: 'Use Code: SAVE5',
      expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(),
      items: [{ id: 'i1', name: 'PS5 Pro', upcs: ['711719024538'], purchaseLinks: [{ name: 'Best Buy', url: 'https://bestbuy.com/eb' }] }],
    };
    const p4dDeal = {
      id: 'p4d-1', name: 'Sony PlayStation 5 Pro Console', payout: 1222, retail: null,
      dealUrl: 'https://www.points4days.com/f/it@deals/x',
      items: [{ id: '9', name: 'PS5 Pro', upcs: ['711719024538'], purchaseLinks: [{ name: 'Best Buy', url: 'https://bestbuy.com/p4d' }, { name: 'Walmart', url: 'https://walmart.com/p4d' }] }],
    };

    it('shows one row with both cashouts, each with its payout and action', () => {
      currentProviders = [...mockProviders, p4dProvider];
      currentDeals = {
        results: [
          { connection: mockConnections[0], deals: [ebDeal] },
          { connection: p4dConnection, deals: [p4dDeal, { id: 'p4d-2', name: 'Only P4D', payout: 50, items: [] }] },
        ],
      };
      render(<MemoryRouter><Cashout /></MemoryRouter>);

      const rows = screen.getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      const row = within(rows[0]);
      expect(row.getByText('PS5 Pro')).toBeInTheDocument(); // EB's deal, which carries the coupon
      expect(row.getByText('Code SAVE5')).toBeInTheDocument();
      expect(row.getByText('EB Primary')).toBeInTheDocument();
      expect(row.getByText('Points4Days')).toBeInTheDocument();
      expect(row.getByText('$1,140.00')).toBeInTheDocument();
      expect(row.getAllByText('$1,222.00').length).toBe(2); // best payout, in the Cashout and Payout columns
      expect(row.getByText('+$322.01')).toBeInTheDocument(); // best payout against EB's retail
      expect(row.getByText(/ends/)).toBeInTheDocument();
      expect(row.getAllByRole('button', { name: 'Log Purchase' })).toHaveLength(1); // one per product
      expect(row.getByRole('link', { name: 'Open on Points4Days' })).toHaveAttribute('href', p4dDeal.dealUrl);
      expect(row.getAllByRole('link', { name: /Buy at Best Buy/ })).toHaveLength(1);
      expect(screen.getByText('Live Deals').parentElement).toHaveTextContent('2');
    });

    it('has one Log Purchase that picks the cashout, with the Points4Days instructions only for Points4Days', async () => {
      currentProviders = [...mockProviders, p4dProvider];
      currentDeals = { results: [{ connection: mockConnections[0], deals: [ebDeal] }, { connection: p4dConnection, deals: [p4dDeal] }] };
      render(<MemoryRouter><Cashout /></MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: 'Log Purchase' }));

      const cashout = screen.getByLabelText('Cashout');
      expect(cashout).toHaveDisplayValue('Points4Days -- $1,222.00'); // best payout first
      expect(screen.getByText(/doesn't commit or send tracking to Points4Days/)).toBeInTheDocument();
      expect(screen.getByLabelText('Sold to')).toHaveValue('group-p4d');

      fireEvent.change(cashout, { target: { value: '1' } });
      expect(screen.queryByText(/doesn't commit or send tracking/)).not.toBeInTheDocument();
      expect(screen.getByText(/without committing to EB Primary/)).toBeInTheDocument();
      expect(screen.getByLabelText('Sold to')).toHaveValue('group-eb');

      fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'vendor-1' } });
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'card-1' } });
      fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999AA10123456784' } });
      expect(screen.getByText(/real, binding pledge/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Insured value/)).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit & Log Purchase' }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
      });
      expect(mockMutations.logPurchase.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        connectionId: 'conn-1', deal_id: 'eb-1', item_id: 'i1', unit_payout: 1140, unit_cost: 899.99, platform_id: 'group-eb',
      }));
    });

    it('filters by cashout before merging, so each cashout still shows on its own', () => {
      currentProviders = [...mockProviders, p4dProvider];
      currentConnections = [...mockConnections, p4dConnection];
      currentDeals = { results: [{ connection: mockConnections[0], deals: [ebDeal] }, { connection: p4dConnection, deals: [p4dDeal] }] };
      render(<MemoryRouter><Cashout /></MemoryRouter>);
      const filter = screen.getByDisplayValue('All Cashouts');
      expect(within(filter).getByRole('option', { name: 'Points4Days' })).toBeInTheDocument();
      fireEvent.change(filter, { target: { value: 'p4d' } });

      const rows = screen.getAllByRole('row').slice(1);
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).queryByText('EB Primary')).not.toBeInTheDocument();
      expect(within(rows[0]).getAllByRole('button', { name: 'Log Purchase' })).toHaveLength(1);
    });

    it('merges only single-product deals from different cashouts', () => {
      const deal = (connectionId, id, upcs, payout, extra = {}) => ({
        connectionId, id, payout, retail: 100, items: [{ id, upcs }], ...extra,
      });
      const groups = groupDealsByProduct([
        deal('eb', 'a', ['1'], 120),
        deal('p4d', 'b', ['1'], 130),
        deal('eb', 'c', ['1'], 125), // same cashout as a: its own row
        deal('p4d', 'd', ['2'], 90, { items: [{ id: 'x', upcs: ['2'] }, { id: 'y', upcs: ['3'] }] }), // bundle
        deal('eb', 'e', ['2'], 95),
        deal('eb', 'f', [], 10),
        deal('p4d', 'g', [], 10),
      ]);
      expect(groups.map((g) => g.offers.map((o) => o.id))).toEqual([['b', 'a'], ['c'], ['d'], ['e'], ['f'], ['g']]);
      expect(groups[0].payout).toBe(130);
      expect(groups[0].estimatedProfit).toEqual({ amount: 30, pct: 30 });
    });

    it('treats differently spelled store names as one store', () => {
      const [group] = groupDealsByProduct([
        { ...ebDeal, connectionId: 'eb', items: [{ ...ebDeal.items[0], purchaseLinks: [{ name: 'BestBuy', url: 'https://bestbuy.com/a' }, { name: 'Amazon', url: 'https://amazon.com/a' }] }] },
        { ...p4dDeal, connectionId: 'p4d', items: [{ ...p4dDeal.items[0], purchaseLinks: [{ name: 'Best Buy', url: 'https://bestbuy.com/b' }, { name: 'Amazon', url: 'https://a.co/b' }, { name: 'Amazon', url: 'https://amazon.com/c' }] }] },
      ]);
      expect(groupStoreLinks(group).map((l) => l.name)).toEqual(['Best Buy', 'Amazon']);
      // One cashout's own links: two links to one store for the same item show once.
      expect(dealStoreLinks(group.offers[0]).map((l) => l.url)).toEqual(['https://bestbuy.com/b', 'https://a.co/b']);
    });

    it('borrows retail from another cashout and lists each store once', () => {
      const [group] = groupDealsByProduct([
        { ...p4dDeal, connectionId: 'p4d' },
        { ...ebDeal, connectionId: 'eb' },
      ]);
      expect(group.retail).toBe(899.99);
      expect(group.offers.map((o) => o.id)).toEqual(['p4d-1', 'eb-1']);
      expect(groupStoreLinks(group).map((l) => l.name)).toEqual(['Best Buy', 'Walmart']);
    });
  });
});

describe('commitmentAccountSummary', () => {
  const r = (name) => ({ sale: { inventory: { account: name ? { name } : null } } });
  it('is empty when no purchase has an account (or no sale)', () => {
    expect(commitmentAccountSummary([r(null), { sale: null }]).label).toBeNull();
  });
  it('names the one account every purchase shares', () => {
    expect(commitmentAccountSummary([r('Bizz'), r('Bizz')])).toEqual({ label: 'Bizz', title: 'Bizz', mixed: false });
  });
  it('counts different accounts', () => {
    expect(commitmentAccountSummary([r('Bizz'), r('CBAmazon'), r('Bizz')])).toEqual({ label: '2 accounts', title: 'Bizz, CBAmazon', mixed: true });
    expect(commitmentAccountSummary([r('Bizz'), r('CBAmazon'), r(null)]).title).toBe('Bizz, CBAmazon, No account');
  });
  it('says Mixed for one account plus purchases with none', () => {
    expect(commitmentAccountSummary([r('Bizz'), r(null)]).label).toBe('Mixed');
  });
});
