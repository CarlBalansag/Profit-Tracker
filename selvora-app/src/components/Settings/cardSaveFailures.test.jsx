import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomCardModal } from './CustomCardModal';
import { QuickAddModal } from './QuickAddModal';
import { PRESET_CARDS } from '../../data/presetCards';
import { PaymentMethods } from './PaymentMethods';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), invalidate: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ apiFetch: mocks.fetch, useInvalidate: () => ({ paymentMethods: mocks.invalidate }) }));
afterEach(cleanup);
describe('card form failure handling', () => {
  it('checks failed parent responses and preserves existing card limits on retry', async () => {
    const card = { id: 'a', name: 'Saved card', type: 'Credit', credit_limit: 5000, default_cashback_rate: 2 };
    let attempts = 0;
    mocks.fetch.mockImplementation(async (path, options) => options?.method === 'PUT'
      ? new Response(JSON.stringify(++attempts === 1 ? { error: 'Database unavailable' } : {}), { status: attempts === 1 ? 500 : 200 })
      : new Response(JSON.stringify([card])));
    render(<PaymentMethods />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Saved card' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Saved card' }));
    expect(document.querySelector('input[name="credit_limit"]').value).toBe('5000');
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Database unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull());
    const writes = mocks.fetch.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1][1].body)).toMatchObject({ type: 'Credit', credit_limit: 5000, default_cashback_rate: 2 });
  });
  it('preserves failed deletions and refreshes the list after successful removal', async () => {
    let cards = [{ id: 'a', name: 'Saved card', type: 'Credit' }]; let attempts = 0;
    mocks.fetch.mockImplementation(async (path, options) => {
      if (options?.method === 'DELETE') {
        if (++attempts === 1) return new Response(JSON.stringify({ error: 'Delete rejected' }), { status: 500 });
        cards = []; return new Response('{}');
      }
      return new Response(JSON.stringify(cards));
    });
    render(<PaymentMethods />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Saved card' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove Saved card' }));
    await waitFor(() => expect(attempts).toBe(1));
    expect(screen.getByRole('button', { name: 'Remove Saved card' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Saved card' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Saved card' })).toBeNull());
  });
  it('keeps a failed card draft and closes only after a successful retry', async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error('Card save failed')).mockResolvedValueOnce({});
    const close = vi.fn();
    render(<CustomCardModal isOpen onClose={close} onAddCard={add} cardToEdit={{ id: 'a', name: 'Saved card', credit_limit: 0 }} />);
    fireEvent.change(screen.getByDisplayValue('Saved card'), { target: { value: 'Edited card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Card save failed'));
    expect(close).not.toHaveBeenCalled(); expect(screen.getByDisplayValue('Edited card')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(add.mock.calls[1][0]).toMatchObject({ name: 'Edited card', credit_limit: 0 });
  });
  it('blocks duplicate submission and dismissal while card saving is pending', async () => {
    let finish;
    const add = vi.fn(() => new Promise(resolve => { finish = resolve; })); const close = vi.fn();
    render(<CustomCardModal isOpen onClose={close} onAddCard={add} />);
    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'New card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));
    fireEvent.click(screen.getByRole('button', { name: /Saving/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close card form' }));
    expect(add).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
    finish({}); await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('retries only unsaved quick-add cards after a partial batch failure', async () => {
    const add = vi.fn().mockImplementationOnce(async (cards, rates, added) => { added(cards[0].id); throw new Error('Second card failed'); }).mockResolvedValueOnce({});
    const close = vi.fn(); render(<QuickAddModal isOpen onClose={close} onAddCards={add} />);
    fireEvent.click(screen.getByText(PRESET_CARDS[0].name, { exact: true }).closest('button'));
    fireEvent.click(screen.getByText(PRESET_CARDS[1].name, { exact: true }).closest('button'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Cards (2)' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Second card failed'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add Cards (1)' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(add.mock.calls[1][0].map(c => c.id)).toEqual([PRESET_CARDS[1].id]);
  });
});
