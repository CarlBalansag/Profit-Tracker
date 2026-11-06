import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Cashout from './Cashout';

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
          financials: {
            payout: 119.0,
            unitCost: 90.0,
            unitCashback: 1.8,
            estimatedProfit: 30.8,
            profitMarginPct: 34.22,
            hasCostData: true,
          },
          match: {
            inventoryId: 'inv-1',
            productName: 'Airpod 5 ANC',
            stockStatus: 'in_stock',
            qtyOnHand: 4,
          },
        },
        {
          id: '9999',
          name: 'Unmatched Unknown Widget',
          retail: 40.0,
          payout: 35.0,
          profitMargin: -12.5,
          financials: {
            payout: 35.0,
            unitCost: null,
            unitCashback: null,
            estimatedProfit: null,
            profitMarginPct: null,
            hasCostData: false,
          },
          match: null,
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
  setMatch: { mutateAsync: vi.fn(), isPending: false },
  removeMatch: { mutateAsync: vi.fn(), isPending: false },
};

let currentProviders = mockProviders;
let currentConnections = mockConnections;
let currentDeals = mockDeals;

vi.mock('../hooks/useApi', () => ({
  useCashoutProviders: () => ({ data: currentProviders, isLoading: false, error: null, refetch: vi.fn() }),
  useCashoutConnections: () => ({ data: currentConnections, isLoading: false, error: null, refetch: vi.fn() }),
  useCashoutDeals: () => ({ data: currentDeals, isLoading: false, error: null, refetch: vi.fn(), isFetching: false }),
  useCashoutHistory: () => ({ data: { snapshots: [] }, isLoading: false, refetch: vi.fn() }),
  useCashoutMutations: () => mockMutations,
  usePlatforms: () => ({ data: [] }),
  useInventory: () => ({ data: [] }),
}));

afterEach(cleanup);

describe('Cashout Page', () => {
  beforeEach(() => {
    currentProviders = mockProviders;
    currentConnections = mockConnections;
    currentDeals = mockDeals;
    vi.clearAllMocks();
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

  it('renders live deals table with profit, payout, cost, and stock badge', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    expect(screen.getByText('Cashout Deals')).toBeInTheDocument();
    expect(screen.getByText('Airpod 5 ANC')).toBeInTheDocument();
    expect(screen.getByText('$119.00')).toBeInTheDocument();
    expect(screen.getByText('$90.00')).toBeInTheDocument();
    expect(screen.getByText('+$30.80')).toBeInTheDocument();
    expect(screen.getByText('In Stock (4)')).toBeInTheDocument();

    // Unmatched item shows "No cost data" and never $0.00
    expect(screen.getByText('Unmatched Unknown Widget')).toBeInTheDocument();
    expect(screen.getByText('No cost data')).toBeInTheDocument();
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
