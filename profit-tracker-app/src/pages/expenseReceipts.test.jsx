// Receipts on expenses: reading a receipt photo on this device (only when
// asked), and attaching the receipt after the expense saves.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Expenses from './Expenses';
import { parseReceiptText } from '../utils/receiptText';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), read: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  usePaymentMethods: () => ({ data: [] }),
}));
vi.mock('../utils/readReceipt', () => ({
  READABLE_RECEIPT_TYPES: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  readReceiptOnDevice: (...args) => mocks.read(...args),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('parseReceiptText', () => {
  it('finds the store, the total (not the subtotal) and the date', () => {
    expect(parseReceiptText('ULINE\n12575 Uline Drive\nTel 800-295-5510\n03/04/2026 10:22\nBoxes 12x12  24.99\nTape  6.50\nSubtotal 31.49\nTax 2.20\nTOTAL $33.69\nVisa 33.69\nThank you'))
      .toEqual({ merchant: 'ULINE', total: '33.69', date: '2026-03-04' });
    expect(parseReceiptText('Walmart\nNov 2, 2026\nSUBTOTAL 10.00\nTOTAL SAVINGS 3.00\nGRAND TOTAL\n12.40')).toEqual({ merchant: 'Walmart', total: '12.40', date: '2026-11-02' });
    expect(parseReceiptText('Shop\n2026-07-09\n1,204.50\n9.99')).toEqual({ merchant: 'Shop', total: '1204.50', date: '2026-07-09' });
  });
  it('returns nothing it can\'t find rather than guessing a bad date', () => {
    expect(parseReceiptText('blurry 13/45/2026 5')).toEqual({ merchant: null, total: null, date: null });
    expect(parseReceiptText('')).toEqual({ merchant: null, total: null, date: null });
  });
});

describe('Add Expense with a receipt', () => {
  let calls;
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const mockApi = ({ attachFails = false } = {}) => {
    calls = [];
    mocks.apiFetch.mockImplementation(async (path, opts = {}) => {
      if (opts.method) {
        calls.push({ path, method: opts.method, body: JSON.parse(opts.body) });
        if (path === '/api/receipts/attach' && attachFails) return { ok: false, status: 400, json: async () => ({ error: 'File too large' }) };
        return json(path === '/api/expenses' ? { id: 'exp-new' } : { success: true });
      }
      if (path === '/api/expenses') return json([{ id: 'exp-1', name: 'Old', amount: 5, date: '2026-01-01T12:00:00Z', category: 'OTHER', payment_method: null }]);
      return json([]);
    });
  };
  const open = async () => {
    render(<MemoryRouter><Expenses /></MemoryRouter>);
    await screen.findByText('Old');
    fireEvent.click(screen.getAllByRole('button', { name: /Add Expense/ })[0]);
    return screen.findByLabelText(/Receipt/);
  };
  const photo = () => new File(['fake-image'], 'receipt.png', { type: 'image/png' });

  it('reads a photo only when asked, fills the form, and attaches the receipt after saving', async () => {
    mockApi();
    mocks.read.mockResolvedValue({ merchant: 'ULINE', total: '33.69', date: '2026-03-04' });
    const input = await open();
    fireEvent.change(input, { target: { files: [photo()] } });
    expect(mocks.read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Read it on this device' }));
    expect(await screen.findByText('Read: ULINE · $33.69 · 2026-03-04. Check them before saving.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Bubble mailers')).toHaveValue('ULINE');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1));
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['/api/expenses', '/api/receipts/attach']));
    expect(calls[0].body).toMatchObject({ name: 'ULINE', amount: 33.69, date: '2026-03-04' });
    expect(calls[1].body).toMatchObject({ itemType: 'expense', itemId: 'exp-new', fileName: 'receipt.png' });
    expect(calls[1].body.fileData).toMatch(/^data:image\/png;base64,/);
  });

  it('keeps what was typed, offers no reading for PDFs, and refuses files it can\'t store', async () => {
    mockApi();
    mocks.read.mockResolvedValue({ merchant: 'ULINE', total: '33.69', date: null });
    const input = await open();
    fireEvent.change(screen.getByPlaceholderText('e.g. Bubble mailers'), { target: { value: 'Boxes' } });
    fireEvent.change(input, { target: { files: [photo()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read it on this device' }));
    await screen.findByText(/Read: ULINE/);
    expect(screen.getByPlaceholderText('e.g. Bubble mailers')).toHaveValue('Boxes');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.change(screen.getByLabelText(/Receipt/), { target: { files: [new File(['%PDF'], 'r.pdf', { type: 'application/pdf' })] } });
    expect(screen.queryByRole('button', { name: 'Read it on this device' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.change(screen.getByLabelText(/Receipt/), { target: { files: [new File(['x'], 'r.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/JPEG, PNG, WebP, GIF, or PDF/);
  });

  it('still saves the expense when the receipt upload fails, and says so', async () => {
    mockApi({ attachFails: true });
    const { toast } = await import('sonner');
    const input = await open();
    fireEvent.change(screen.getByPlaceholderText('e.g. Bubble mailers'), { target: { value: 'Tape' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '4' } });
    fireEvent.change(input, { target: { files: [photo()] } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Expense saved, but the receipt didn't upload: File too large/)));
    expect(calls.map((c) => c.path)).toEqual(['/api/expenses', '/api/receipts/attach']);
  });
});
