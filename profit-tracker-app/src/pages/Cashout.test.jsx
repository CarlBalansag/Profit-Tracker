import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Cashout from './Cashout';
import { estimateDealProfit } from '../utils/cashoutDeals';

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

vi.mock('../hooks/useApi', () => ({
  useCashoutProviders: () => ({ data: currentProviders, isLoading: false, error: null, refetch: vi.fn() }),
  useCashoutConnections: () => ({ data: currentConnections, isLoading: false, error: null, refetch: vi.fn() }),
  useCashoutDeals: () => ({ data: currentDeals, isLoading: false, error: null, refetch: vi.fn(), isFetching: false }),
  useCashoutHistory: () => ({ data: { snapshots: [] }, isLoading: false, refetch: vi.fn() }),
  useCashoutMutations: () => mockMutations,
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

  it('sorts by highest payout by default', () => {
    render(
      <MemoryRouter>
        <Cashout />
      </MemoryRouter>
    );

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Airpod 5 ANC');
    expect(rows[1]).toHaveTextContent('Unmatched Unknown Widget');
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
      ['Deal / Item', 'Service', 'Payout', 'Retail', 'Est. Profit', 'Availability', 'Link'],
    );
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

    fireEvent.change(screen.getByDisplayValue('Highest Payout'), { target: { value: 'profit_desc' } });

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
