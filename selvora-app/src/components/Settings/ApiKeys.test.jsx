import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeys } from './ApiKeys';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));

afterEach(cleanup);

describe('ApiKeys tools guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
  });

  it('shows the connect instructions and every read/write tool, expanded by default', async () => {
    render(<ApiKeys />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    expect(screen.getByText('Guide: what it can do')).toBeTruthy();
    expect(screen.getByText(/api.profittracker.carltechs.com\/mcp/)).toBeTruthy();

    // A representative tool from each category, including the three newest ones.
    for (const name of ['list_sales', 'list_shipments', 'get_card_net_to_pay', 'add_purchase', 'update_shipment', 'mark_sale_paid']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('collapses and re-expands on click', async () => {
    render(<ApiKeys />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    expect(screen.getByText('list_sales')).toBeTruthy();
    fireEvent.click(screen.getByText('Guide: what it can do'));
    expect(screen.queryByText('list_sales')).toBeNull();
    fireEvent.click(screen.getByText('Guide: what it can do'));
    expect(screen.getByText('list_sales')).toBeTruthy();
  });
});
