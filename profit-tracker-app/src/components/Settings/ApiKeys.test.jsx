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

  it('shows the connect instructions, with the guide behind a toggle', async () => {
    render(<ApiKeys />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    expect(screen.getByText('Guide: what it can do')).toBeTruthy();
    expect(screen.getByText(/api.profittracker.carltechs.com\/mcp/)).toBeTruthy();
    expect(screen.queryByText('get_ai_guide', { selector: 'li code' })).toBeTruthy();
    expect(screen.queryByText('list_sales')).toBeNull();
  });

  it('shows the exact guide an AI reads: every registered tool, nothing stale', async () => {
    render(<ApiKeys />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: `Show the guide (version ${AI_GUIDE_VERSION})` }));
    for (const name of ['list_sales', 'mark_sale_paid', 'match_deposit', 'find_records', 'update_expense', 'delete_refund', 'get_ai_guide']) {
      // Grouped tools ("add_expense, update_expense") share one code element.
      const shown = screen.queryAllByText((_, el) => el.tagName === 'CODE' && el.textContent.split(', ').includes(name));
      expect(shown.length, name).toBeGreaterThan(0);
    }
    // The old hand-written list claimed this; the guide doesn't.
    expect(screen.queryByText(/No delete tools exist/)).toBeNull();
    expect(screen.getByText('ground rules')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide the guide' }));
    expect(screen.queryByText('list_sales')).toBeNull();
  });

  it('collapses and re-expands on click', async () => {
    render(<ApiKeys />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    expect(screen.getByText(/api.profittracker.carltechs.com\/mcp/)).toBeTruthy();
    fireEvent.click(screen.getByText('Guide: what it can do'));
    expect(screen.queryByText(/api.profittracker.carltechs.com\/mcp/)).toBeNull();
    fireEvent.click(screen.getByText('Guide: what it can do'));
    expect(screen.getByText(/api.profittracker.carltechs.com\/mcp/)).toBeTruthy();
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

describe('ApiKeys: send the full guide again', () => {
  const keyRow = (fields) => ({ id: 'k1', name: 'Grok', key_prefix: 'pt_abc', created_at: '2026-11-01T00:00:00Z', last_used_at: null, revoked_at: null, allow_cashout_writes: false, ai_guide_version: AI_GUIDE_VERSION, ...fields });
  beforeEach(() => vi.clearAllMocks());

  it('resets the key so its AI gets the whole guide next time', async () => {
    let rows = [keyRow({})];
    mocks.apiFetch.mockImplementation((path, opts = {}) => {
      if (opts.method === 'PATCH') {
        rows = [keyRow({ ai_guide_version: null })];
        return Promise.resolve(new Response(JSON.stringify(rows[0]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
    });
    render(<ApiKeys />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send the full guide again' }));
    await waitFor(() => expect(screen.getByTestId('key-guide-status').textContent).toBe('AI guide: not pulled yet'));
    const patch = mocks.apiFetch.mock.calls.find(([, o]) => o?.method === 'PATCH');
    expect(patch[0]).toBe('/api/api-keys/k1');
    expect(JSON.parse(patch[1].body)).toEqual({ reset_ai_guide: true });
    expect(screen.queryByRole('button', { name: 'Send the full guide again' })).toBeNull();
  });

  it('is not offered for a key that has not pulled the guide', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify([keyRow({ ai_guide_version: null })]), { status: 200 }));
    render(<ApiKeys />);
    await screen.findByTestId('key-guide-status');
    expect(screen.queryByRole('button', { name: 'Send the full guide again' })).toBeNull();
  });
});
