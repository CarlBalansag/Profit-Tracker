import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useRecordActions from './useRecordActions';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  inventory: vi.fn(),
  sales: vi.fn(),
  dashboard: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  all: vi.fn(),
}));

vi.mock('./useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ inventory: mocks.inventory, sales: mocks.sales, dashboard: mocks.dashboard, all: mocks.all }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const ok = (body = {}) => new Response(JSON.stringify({ id: 'r1', allowed_actions: [], ...body }));

// Block body on purpose: an arrow that *returns* the mock would hand Vitest the
// mock function as a per-test teardown callback, which it then invokes -- leaving
// a stray zero-argument apiFetch call recorded against the next test.
beforeEach(() => { mocks.apiFetch.mockResolvedValue(ok()); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('useRecordActions', () => {
  it('POSTs to the inventory action endpoint with the payload', async () => {
    const record = { id: 'inv1', receiving_status: 'PURCHASED' };
    const { result } = renderHook(() => useRecordActions({ kind: 'inventory', record }));

    await act(() => result.current.runAction('add_tracking', { tracking_number: '1Z999' }, { label: 'Add Tracking' }));

    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/inventory/inv1/actions/add_tracking');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ tracking_number: '1Z999' });
  });

  it('POSTs to the sales action endpoint for a sale', async () => {
    const record = { id: 'sale1', workflow_status: 'WAITING_FOR_PAYMENT' };
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record }));

    await act(() => result.current.runAction('mark_paid', { paid_date: '2026-10-02', amount: '10.00' }, { label: 'Mark Paid' }));

    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/sales/sale1/actions/mark_paid');
  });

  // check_tracking is an allowed action but not a stored transition, so it must
  // go to the pre-existing /track endpoint rather than /actions/check_tracking.
  it('sends check_tracking to the existing /track endpoint', async () => {
    const record = { id: 'sale1', workflow_status: 'OUTBOUND' };
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record }));

    await act(() => result.current.runAction('check_tracking', {}, { label: 'Check Tracking' }));

    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/sales/sale1/track');
  });

  it('refreshes inventory, sales and dashboard caches after a success', async () => {
    const { result } = renderHook(() => useRecordActions({ kind: 'inventory', record: { id: 'inv1', receiving_status: 'PRE_ORDER' } }));
    await act(() => result.current.runAction('mark_purchased', {}, { label: 'Mark Purchased' }));

    expect(mocks.inventory).toHaveBeenCalled();
    expect(mocks.sales).toHaveBeenCalled();
    expect(mocks.dashboard).toHaveBeenCalled();
  });

  it('surfaces the API error message on error state and as a toast, and returns null', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Sale changed while saving. Reload and retry.' }), { status: 409 }));
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record: { id: 'sale1', workflow_status: 'OUTBOUND' } }));

    let returned;
    await act(async () => { returned = await result.current.runAction('cancel_sale', {}, { label: 'Cancel Sale' }); });

    expect(returned).toBeNull();
    await waitFor(() => expect(result.current.error).toBe('Sale changed while saving. Reload and retry.'));
    expect(mocks.error).toHaveBeenCalledWith('Cancel Sale failed: Sale changed while saving. Reload and retry.');
    expect(mocks.inventory).not.toHaveBeenCalled();
  });

  it('falls back to a status-code message when the API sends no error body', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('not json', { status: 500 }));
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record: { id: 'sale1', workflow_status: 'OUTBOUND' } }));

    await act(() => result.current.runAction('check_tracking', {}, { label: 'Check Tracking' }));
    await waitFor(() => expect(result.current.error).toBe('Request failed (500)'));
  });

  it('reports no record to act on rather than calling the API', async () => {
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record: null }));
    await act(() => result.current.runAction('mark_paid', {}, { label: 'Mark Paid' }));

    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(result.current.error).toBe('No record to act on');
  });

  it('clears the pending action when the request settles', async () => {
    const { result } = renderHook(() => useRecordActions({ kind: 'inventory', record: { id: 'inv1', receiving_status: 'ON_HAND' } }));
    await act(() => result.current.runAction('list_item', {}, { label: 'List Item' }));

    expect(result.current.pendingAction).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ─── Undo ───────────────────────────────────────────────────────────────────
  // Undo is the server's: the response's activity_id is what gets reversed, so
  // it is offered for every logged action, Cancel and Mark Paid included.
  it('offers Undo for a logged action and asks the server to reverse that entry', async () => {
    mocks.apiFetch.mockResolvedValue(ok({ activity_id: 'act-1' }));
    const record = { id: 'sale1', workflow_status: 'PAID', quantity: 2 };
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record }));

    await act(() => result.current.runAction('cancel_sale', {}, { label: 'Cancel Sale', destructive: true }));
    const [message, options] = mocks.success.mock.calls[0];
    expect(message).toBe('Cancel Sale — done.');
    expect(options.action.label).toBe('Undo');

    mocks.apiFetch.mockClear();
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ undone: {}, entry: {} })));
    await act(() => options.action.onClick());
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/activity/act-1/undo', { method: 'POST' });
    // An undo can move stock and money, so everything is refreshed.
    expect(mocks.all).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenLastCalledWith('Undone.');
  });

  it("shows the server's reason when an undo is refused", async () => {
    mocks.apiFetch.mockResolvedValue(ok({ activity_id: 'act-1' }));
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record: { id: 'sale1' } }));
    await act(() => result.current.runAction('cancel_sale', {}, { label: 'Cancel Sale' }));

    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: "The 2 units this put back in stock have since been sold or used, so it can't be undone." }), { status: 409 }));
    await act(() => mocks.success.mock.calls[0][1].action.onClick());
    expect(mocks.error).toHaveBeenCalledWith("Could not undo: The 2 units this put back in stock have since been sold or used, so it can't be undone.");
    expect(mocks.all).not.toHaveBeenCalled();
  });

  it('shows a plain toast when the response carries no activity entry (e.g. Check Tracking)', async () => {
    const { result } = renderHook(() => useRecordActions({ kind: 'inventory', record: { id: 'inv1', receiving_status: 'INBOUND' } }));
    await act(() => result.current.runAction('check_tracking', {}, { label: 'Check Tracking' }));
    expect(mocks.success).toHaveBeenCalledWith('Check Tracking — done.');
  });
});
