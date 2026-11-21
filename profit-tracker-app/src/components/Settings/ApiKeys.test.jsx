import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeys } from './ApiKeys';
import { AI_GUIDE_VERSION } from '../../../../shared/aiGuide.mjs';

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

describe('ApiKeys cashout writes switch', () => {
  const key = (allow) => ({ id: 'k1', name: 'Claude', key_prefix: 'pt_abc', created_at: '2026-11-01T00:00:00Z', last_used_at: null, revoked_at: null, allow_cashout_writes: allow });

  beforeEach(() => vi.clearAllMocks());

  it('is off by default and turns on for that one key', async () => {
    mocks.apiFetch.mockImplementation(async (path, options = {}) => {
      if (options.method === 'PATCH') return new Response(JSON.stringify(key(true)), { status: 200 });
      return new Response(JSON.stringify([key(false)]), { status: 200 });
    });
    render(<ApiKeys />);
    const box = await screen.findByRole('checkbox', { name: /Allow cashout writes/ });
    expect(box.checked).toBe(false);

    fireEvent.click(box);

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/api-keys/k1', expect.objectContaining({ method: 'PATCH' })));
    const patch = mocks.apiFetch.mock.calls.find(([, o]) => o?.method === 'PATCH');
    expect(JSON.parse(patch[1].body)).toEqual({ allow_cashout_writes: true });
  });

  it("isn't shown on a revoked key", async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify([{ ...key(false), revoked_at: '2026-11-02T00:00:00Z' }]), { status: 200 }));
    render(<ApiKeys />);
    await screen.findByText('Revoked');
    expect(screen.queryByRole('checkbox', { name: /Allow cashout writes/ })).toBeNull();
  });
});

describe('ApiKeys: AI guide version per key', () => {
  const keyRow = (fields) => ({ id: 'k1', name: 'Grok', key_prefix: 'pt_abc', created_at: '2026-11-01T00:00:00Z', last_used_at: null, revoked_at: null, allow_cashout_writes: false, ai_guide_version: null, ...fields });
  const show = async (rows) => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));
    render(<ApiKeys />);
    return screen.findAllByTestId('key-guide-status');
  };

  beforeEach(() => vi.clearAllMocks());

  it('says when a key has never pulled the guide', async () => {
    const [status] = await show([keyRow({})]);
    expect(status.textContent).toBe('AI guide: not pulled yet');
  });

  it('says up to date on the current version', async () => {
    const [status] = await show([keyRow({ ai_guide_version: AI_GUIDE_VERSION })]);
    expect(status.textContent).toBe(`AI guide: up to date (${AI_GUIDE_VERSION})`);
  });

  it('says how far behind an older version is', async () => {
    const [status] = await show([keyRow({ ai_guide_version: '1.01' })]);
    expect(status.textContent).toContain(`read 1.01, now ${AI_GUIDE_VERSION}`);
  });

  it('shows nothing for a revoked key', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify([keyRow({ revoked_at: '2026-11-02T00:00:00Z' })]), { status: 200 }));
    render(<ApiKeys />);
    await screen.findByText('Revoked');
    expect(screen.queryByTestId('key-guide-status')).toBeNull();
  });
});
