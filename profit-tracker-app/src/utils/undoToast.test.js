import { afterEach, describe, expect, it, vi } from 'vitest';
import { toastWithUndo } from './undoToast';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const ok = () => new Response(JSON.stringify({ undone: {}, entry: {} }));
const refused = (error) => new Response(JSON.stringify({ error }), { status: 409 });
const undoButton = () => mocks.success.mock.calls[0][1].action;

afterEach(() => vi.clearAllMocks());

describe('toastWithUndo', () => {
  it('shows a plain toast when nothing was logged', () => {
    toastWithUndo('Saved.', null);
    toastWithUndo('Deleted 2 items.', [null, undefined]);
    expect(mocks.success.mock.calls).toEqual([['Saved.'], ['Deleted 2 items.']]);
  });

  it('keeps the Undo toast up for 10 seconds', () => {
    toastWithUndo('Saved.', 'a1');
    expect(mocks.success.mock.calls[0][1]).toMatchObject({ duration: 10000, action: { label: 'Undo' } });
  });

  it('undoes a batch newest first, then refreshes', async () => {
    mocks.apiFetch.mockResolvedValue(ok());
    const refresh = vi.fn();
    toastWithUndo('Deleted 3 items.', ['a1', 'a2', 'a3'], refresh);
    await undoButton().onClick();
    expect(mocks.apiFetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/activity/a3/undo', '/api/activity/a2/undo', '/api/activity/a1/undo',
    ]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenLastCalledWith('Undone.');
  });

  it('stops at the first refusal and says how far it got', async () => {
    mocks.apiFetch.mockResolvedValueOnce(ok()).mockResolvedValueOnce(refused('This sale changed after this.'));
    const refresh = vi.fn();
    toastWithUndo('Deleted 3 items.', ['a1', 'a2', 'a3'], refresh);
    await undoButton().onClick();
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledWith('Could not undo (1 of 3 undone): This sale changed after this.');
    // Something did change, so the screen is refreshed anyway.
    expect(refresh).toHaveBeenCalledOnce();
  });
});
