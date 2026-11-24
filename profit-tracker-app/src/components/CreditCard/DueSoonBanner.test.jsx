// Uses the real useTodos/useTodoState hooks over a fake API, so the list really
// shrinks as bills are marked paid.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import DueSoonBanner from './DueSoonBanner';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), toasts) }));

const due = (cardId, date, detail, over = {}) => ({
  key: `card-due:${cardId}:${date}`, type: 'card_due', group: 'cards', urgency: 'soon', title: `Pay Card ${cardId}`, detail, due_date: date, ...over,
});
const missed = (cardId, date) => due(cardId, date, 'Due Nov 22', { type: 'card_overdue', urgency: 'overdue', title: `Card ${cardId} was due 2 days ago` });
const card = (id, date, over = {}) => ({ id, name: `Card ${id}`, last4: null, statementDue: date, statementBalance: 432.1, ...over });

let server;
let client;
// The list the API would return: everything not marked done.
const stillOpen = () => server.todos.filter((t) => !server.done.has(t.key));

function view(todos, cards = []) {
  Object.assign(server, { todos, cards });
  return render(<QueryClientProvider client={client}><MemoryRouter><DueSoonBanner /></MemoryRouter></QueryClientProvider>);
}
const banner = () => screen.queryByRole('region', { name: 'Card payments due' });
const rows = () => within(banner()).getAllByRole('listitem').map((li) => li.querySelector('div').textContent);
const settled = () => waitFor(() => expect(client.isFetching()).toBe(0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 24, 23, 30)); // late evening, local time
  server = { todos: [], cards: [], done: new Set(), fail: false, writes: [] };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const { pathname, searchParams } = new URL(url, 'http://app.test');
    const ok = (body) => ({ ok: true, status: 200, headers: new Headers(), json: async () => structuredClone(body), clone() { return this; } });
    if (pathname === '/api/todos/state') {
      const body = options.body ? JSON.parse(options.body) : {};
      const key = body.key ?? searchParams.get('key');
      server.writes.push([options.method, key, body.action]);
      if (server.fail) return { ...ok({ error: 'Offline' }), ok: false, status: 500 };
      if (options.method === 'DELETE') server.done.delete(key); else server.done.add(key);
      return ok({ key });
    }
    if (pathname === '/api/todos') return ok({ items: stillOpen(), counts: {}, hidden: 0 });
    return ok({ cards: server.cards });
  }));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Card payments due banner', () => {
  it('lists each bill, soonest first, with the statement for its due date', async () => {
    view(
      [due('b', '2026-11-27', 'Due in 3 days'), due('c', '2026-11-24', 'Due today'), due('a', '2026-11-25', 'Due tomorrow')],
      [card('b', '2026-11-27'), card('c', '2026-11-24'), card('a', '2026-11-25', { statementBalance: 1250.5 })],
    );
    await screen.findByText('Pay Card a');
    await screen.findByText('$1,250.50');
    expect(rows()).toEqual([
      'Pay Card cAbout $432.10 · Due today',
      'Pay Card aAbout $1,250.50 · Due tomorrow',
      'Pay Card bAbout $432.10 · Due in 3 days',
    ]);
    expect(screen.getByRole('link', { name: 'Open To-Do' })).toHaveAttribute('href', '/todos');
  });

  it('shows a missed payment first, with no amount when the estimate is for the next bill', async () => {
    view(
      [due('a', '2026-11-26', 'Due in 2 days'), missed('b', '2026-11-22')],
      [card('a', '2026-11-26'), card('b', '2026-12-22', { statementBalance: 999 })],
    );
    await screen.findByText('$432.10');
    expect(rows()).toEqual(['Card b was due 2 days agoDue Nov 22', 'Pay Card aAbout $432.10 · Due in 2 days']);
    expect(screen.queryByText(/999/)).toBeNull();
  });

  it('gives a missed payment its amount while Cash Flow still has that statement', async () => {
    view([missed('b', '2026-11-22')], [card('b', '2026-11-22', { statementBalance: 80.5 })]);
    expect(await screen.findByText('$80.50')).toBeInTheDocument();
  });

  it('keeps a bill with no usable estimate, without an amount', async () => {
    view(
      [due('a', '2026-11-25', 'Due tomorrow'), due('b', '2026-11-25', 'Due tomorrow'), due('c', '2026-11-25', 'Due tomorrow'), due('d', '2026-11-25', 'Due tomorrow')],
      // $0 tracked, a credit, a different statement, and no card at all.
      [card('a', '2026-11-25', { statementBalance: 0 }), card('b', '2026-11-25', { statementBalance: -20 }), card('c', '2026-12-25')],
    );
    await screen.findByText('Pay Card d');
    await settled();
    expect(rows()).toEqual(['a', 'b', 'c', 'd'].map((id) => `Pay Card ${id}Due tomorrow`));
  });

  it('shows nothing for other to-dos or a saved bill whose date has passed', async () => {
    const { container } = view([due('a', '2026-11-23', 'Due tomorrow'), { key: 'ship:1', type: 'ship', due_date: '2026-11-25', title: 'Ship', detail: '' }]);
    await settled();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing while loading', () => {
    const { container } = view([due('a', '2026-11-25', 'Due tomorrow')]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Mark paid', () => {
  const press = (name) => fireEvent.click(screen.getByRole('button', { name }));

  it('clears only that bill', async () => {
    view([due('a', '2026-11-25', 'Due tomorrow'), due('b', '2026-11-26', 'Due in 2 days')]);
    await screen.findByText('Pay Card a');
    press(/Mark paid.*Pay Card a/);
    await waitFor(() => expect(screen.queryByText('Pay Card a')).toBeNull());
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Pay Card b')).toBeInTheDocument();
    expect(server.writes).toEqual([['POST', 'card-due:a:2026-11-25', 'done']]);
  });

  it('still confirms, with Undo, after the last bill is gone', async () => {
    const { container } = view([missed('a', '2026-11-22')]);
    await screen.findByText('Card a was due 2 days ago');
    press(/Mark paid/);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Marked paid.', expect.anything()));

    toasts.success.mock.calls[0][1].action.onClick();
    expect(await screen.findByText('Card a was due 2 days ago')).toBeInTheDocument();
    expect(server.writes.map(([method]) => method)).toEqual(['POST', 'DELETE']);
  });

  it('confirms even when the page was left before the save came back', async () => {
    const { unmount } = view([due('a', '2026-11-25', 'Due tomorrow')]);
    await screen.findByText('Pay Card a');
    press(/Mark paid/);
    unmount();
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
  });

  it('brings the bill back and says so when it could not be saved', async () => {
    view([due('a', '2026-11-25', 'Due tomorrow')]);
    await screen.findByText('Pay Card a');
    server.fail = true;
    press(/Mark paid/);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Could not save: Offline'));
    expect(await screen.findByText('Pay Card a')).toBeInTheDocument();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('says so when the undo could not be saved', async () => {
    view([due('a', '2026-11-25', 'Due tomorrow')]);
    await screen.findByText('Pay Card a');
    press(/Mark paid/);
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    server.fail = true;
    toasts.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Could not undo: Offline'));
  });
});
