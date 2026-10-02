import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useRecordActions, { inverseFor } from './useRecordActions';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  inventory: vi.fn(),
  sales: vi.fn(),
  dashboard: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ inventory: mocks.inventory, sales: mocks.sales, dashboard: mocks.dashboard }),
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
  it('offers Undo and sends the paired inverse action when one exists', async () => {
    mocks.apiFetch.mockResolvedValue(ok({ allowed_actions: [{ action: 'unlist', label: 'Unlist' }] }));
    const { result } = renderHook(() => useRecordActions({ kind: 'inventory', record: { id: 'inv1', receiving_status: 'ON_HAND' } }));

    await act(() => result.current.runAction('list_item', {}, { label: 'List Item' }));

    const [, options] = mocks.success.mock.calls[0];
    expect(options.action.label).toBe('Undo');

    mocks.apiFetch.mockClear();
    await act(() => options.action.onClick());
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/inventory/inv1/actions/unlist');
  });

  it('undoes a pure status step by correcting back to the previous status', async () => {
    mocks.apiFetch.mockResolvedValue(ok({ allowed_actions: [{ action: 'correct_status', label: 'Correct Receiving Step' }] }));
    const record = { id: 'inv1', receiving_status: 'PRE_ORDER', correction_note: 'vendor delay' };
    const { result } = renderHook(() => useRecordActions({ kind: 'inventory', record }));

    await act(() => result.current.runAction('mark_purchased', {}, { label: 'Mark Purchased' }));
    mocks.apiFetch.mockClear();
    await act(() => mocks.success.mock.calls[0][1].action.onClick());

    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/inventory/inv1/actions/correct_status');
    // The note is carried back, because inventory's correct_status rewrites it.
    expect(JSON.parse(options.body)).toEqual({ receiving_status: 'PRE_ORDER', correction_note: 'vendor delay' });
  });

  // No fake Undo button: it is only attached when the record's own recomputed
  // allowed_actions confirm the inverse is actually available.
  it('shows a plain toast when the inverse action is not allowed on the new state', async () => {
    mocks.apiFetch.mockResolvedValue(ok({ allowed_actions: [{ action: 'mark_on_hand', label: 'Mark On Hand' }] }));
    const { result } = renderHook(() => useRecordActions({ kind: 'inventory', record: { id: 'inv1', receiving_status: 'PRE_ORDER' } }));

    await act(() => result.current.runAction('mark_purchased', {}, { label: 'Mark Purchased' }));
    expect(mocks.success).toHaveBeenCalledWith('Mark Purchased — done.');
  });

  it('never offers Undo for destructive or milestone-writing actions', async () => {
    mocks.apiFetch.mockResolvedValue(ok({ allowed_actions: [{ action: 'correct_status', label: 'Correct Workflow Step' }] }));
    const record = { id: 'sale1', workflow_status: 'WAITING_FOR_PAYMENT', quantity: 2 };
    const { result } = renderHook(() => useRecordActions({ kind: 'sale', record }));

    await act(() => result.current.runAction('mark_paid', { paid_date: '2026-10-02', amount: '5.00' }, { label: 'Mark Paid' }));
    expect(mocks.success).toHaveBeenCalledWith('Mark Paid — done.');

    mocks.success.mockClear();
    await act(() => result.current.runAction('cancel_sale', {}, { label: 'Cancel Sale', destructive: true }));
    expect(mocks.success).toHaveBeenCalledWith('Cancel Sale — done.');
  });
});

describe('inverseFor', () => {
  it('pairs listing and unlisting', () => {
    expect(inverseFor('inventory', { is_listed: false }, 'list_item')).toEqual({ action: 'unlist', payload: {} });
    expect(inverseFor('inventory', { is_listed: true }, 'unlist')).toEqual({ action: 'list_item', payload: {} });
  });

  it('corrects a sale back to its previous workflow status', () => {
    expect(inverseFor('sale', { workflow_status: 'SCANNED_IN' }, 'mark_accepted'))
      .toEqual({ action: 'correct_status', payload: { workflow_status: 'SCANNED_IN' } });
  });

  it('refuses an inverse for quantity-moving, date-writing and destructive actions', () => {
    const sale = { workflow_status: 'WAITING_FOR_PAYMENT', quantity: 2 };
    expect(inverseFor('sale', sale, 'mark_paid')).toBeNull();
    expect(inverseFor('sale', sale, 'cancel_sale', { destructive: true })).toBeNull();
    expect(inverseFor('sale', sale, 'void_sale', { destructive: true })).toBeNull();
    expect(inverseFor('inventory', { receiving_status: 'INBOUND' }, 'mark_on_hand')).toBeNull();
    expect(inverseFor('inventory', { receiving_status: 'PURCHASED' }, 'add_tracking')).toBeNull();
  });

  it('refuses an inverse when the previous status is unknown', () => {
    expect(inverseFor('inventory', { receiving_status: null }, 'mark_purchased')).toBeNull();
  });
});
