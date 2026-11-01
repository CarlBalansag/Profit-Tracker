import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionNotesPanel from './TransactionNotesPanel';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const ENTITY_ID = '33333333-3333-4333-8333-333333333333';
const note = (over) => ({
  entity_type: 'purchase', entity_id: ENTITY_ID, author: 'carl', pinned: false,
  created_at: '2026-10-31T14:04:00.000Z', updated_at: '2026-10-31T14:04:00.000Z', ...over,
});
const NOTES = [
  note({ id: 'n1', body: 'Unpinned by carl' }),
  note({ id: 'n2', body: 'Pinned by bot', author: 'bot', pinned: true }),
];

const json = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
let fetchMock;
let notesResponse;

function route(url, opts = {}) {
  const method = opts.method || 'GET';
  if (url.includes('/api/product-notes')) return json({ note: 'Shared product text' });
  if (url.includes('/api/transaction-notes') && method === 'GET') return json(notesResponse);
  if (method === 'POST') return json(note({ id: 'n3', body: JSON.parse(opts.body).body }), 201);
  if (method === 'PATCH') return json(note({ id: 'n1', body: 'x', ...JSON.parse(opts.body) }));
  if (method === 'DELETE') return json({ success: true });
  return json({ error: 'unexpected' }, 500);
}

function renderPanel(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TransactionNotesPanel entityType="purchase" entityId={ENTITY_ID} productName="Widget" {...props} />
    </QueryClientProvider>,
  );
}

const callsWith = (method) => fetchMock.mock.calls.filter(([, o]) => (o?.method || 'GET') === method);

beforeEach(() => {
  notesResponse = NOTES;
  fetchMock = vi.fn(route);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('TransactionNotesPanel', () => {
  it('renders notes pinned first with Bot/Carl labels and the product note', async () => {
    renderPanel();
    const rows = await screen.findAllByTestId('transaction-note');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Pinned by bot');
    expect(within(rows[0]).getByText('Bot')).toBeTruthy();
    expect(rows[1].textContent).toContain('Unpinned by carl');
    expect(within(rows[1]).getByText('Carl')).toBeTruthy();
    expect(screen.getByTestId('note-count').textContent).toBe('2');
    expect(await screen.findByText('Shared product text')).toBeTruthy();
    expect(screen.getByText('Shared by every transaction named Widget')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => u.includes('/api/transaction-notes?entity_type=purchase'))).toBe(true);
  });

  it('shows the empty state', async () => {
    notesResponse = [];
    renderPanel();
    expect(await screen.findByText('No notes on this transaction yet.')).toBeTruthy();
  });

  it('adds a note with POST and the right body; button disabled while empty', async () => {
    notesResponse = [];
    renderPanel();
    await screen.findByText('No notes on this transaction yet.');
    const addBtn = screen.getByRole('button', { name: 'Add note' });
    expect(addBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Add a note…'), { target: { value: '  hello  ' } });
    expect(addBtn.disabled).toBe(false);
    fireEvent.click(addBtn);
    await waitFor(() => expect(callsWith('POST')).toHaveLength(1));
    const [url, opts] = callsWith('POST')[0];
    expect(url).toContain('/api/transaction-notes');
    expect(JSON.parse(opts.body)).toEqual({ entity_type: 'purchase', entity_id: ENTITY_ID, body: 'hello' });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Note added'));
  });

  it('Ctrl+Enter submits the add box', async () => {
    renderPanel();
    await screen.findAllByTestId('transaction-note');
    const box = screen.getByPlaceholderText('Add a note…');
    fireEvent.change(box, { target: { value: 'quick' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(callsWith('POST')).toHaveLength(1));
  });

  it('pin toggles PATCH', async () => {
    renderPanel();
    await screen.findAllByTestId('transaction-note');
    fireEvent.click(screen.getByRole('button', { name: 'Pin note' }));
    await waitFor(() => expect(callsWith('PATCH')).toHaveLength(1));
    const [url, opts] = callsWith('PATCH')[0];
    expect(url).toContain('/api/transaction-notes/n1');
    expect(JSON.parse(opts.body)).toEqual({ pinned: true });
  });

  it('edit saves the new body with PATCH', async () => {
    renderPanel();
    const rows = await screen.findAllByTestId('transaction-note');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Edit note' }));
    fireEvent.change(within(rows[1]).getByRole('textbox', { name: 'Edit note' }), { target: { value: 'changed' } });
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsWith('PATCH')).toHaveLength(1));
    expect(JSON.parse(callsWith('PATCH')[0][1].body)).toEqual({ body: 'changed' });
  });

  it('delete asks inline, No cancels, Yes calls DELETE', async () => {
    renderPanel();
    const rows = await screen.findAllByTestId('transaction-note');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Delete note' }));
    expect(within(rows[1]).getByText('Delete?')).toBeTruthy();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'No' }));
    expect(within(rows[1]).queryByText('Delete?')).toBeNull();
    expect(callsWith('DELETE')).toHaveLength(0);
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Delete note' }));
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(callsWith('DELETE')).toHaveLength(1));
    expect(callsWith('DELETE')[0][0]).toContain('/api/transaction-notes/n1');
  });

  it('shows an error toast when a mutation fails', async () => {
    fetchMock.mockImplementation((url, opts = {}) => (opts.method === 'PATCH'
      ? json({ error: 'Note not found' }, 404)
      : route(url, opts)));
    renderPanel();
    await screen.findAllByTestId('transaction-note');
    fireEvent.click(screen.getByRole('button', { name: 'Pin note' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Note not found'));
  });

  it('showProductNote=false hides the product block', async () => {
    renderPanel({ entityType: 'sale', showProductNote: false });
    await screen.findAllByTestId('transaction-note');
    expect(screen.queryByTestId('product-note-block')).toBeNull();
    expect(screen.queryByText(/Shared by every transaction/)).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => u.includes('/api/product-notes'))).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toContain('entity_type=sale');
  });
});
