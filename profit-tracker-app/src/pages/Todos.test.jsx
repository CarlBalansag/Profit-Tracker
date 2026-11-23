import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Todos from './Todos';
import TodoSummary from '../components/Dashboard/TodoSummary';
import { addDays, localToday } from '../utils/returnWindow';

let todos;
let queryState;
const mutate = vi.fn();
const mutateAsync = vi.fn(async () => ({}));

let openReminders = [];
const reminderCalls = { create: vi.fn(), update: vi.fn(), remove: vi.fn(), complete: vi.fn(), undoComplete: vi.fn() };
const asyncMutation = (fn) => ({ mutateAsync: fn, mutate: fn, isPending: false });

vi.mock('../hooks/useApi', () => ({
  useTodos: () => ({ data: todos, isLoading: false, isError: queryState.isError, refetch: vi.fn(), isRefetching: false }),
  useTodoState: () => ({ mutate, mutateAsync, isPending: false }),
  useReminders: () => ({ data: openReminders }),
  useReminderMutations: () => Object.fromEntries(Object.entries(reminderCalls).map(([name, fn]) => [name, asyncMutation(fn)])),
  usePaymentMethods: () => ({ data: [{ id: 'card-1', name: 'Amex Gold', last4: '1001' }] }),
  useAutomationReview: () => ({ data: { to_confirm: automationToConfirm.count } }),
}));
const automationToConfirm = vi.hoisted(() => ({ count: 0 }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The sale step on an item (Add tracking, Mark paid...) runs through the
// shared status-action hook; here it only records what it was asked.
const runAction = vi.fn(async () => ({ id: 'sale-1' }));
vi.mock('../hooks/useRecordActions', () => ({ default: () => ({ runAction, pendingAction: null }) }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const entry = (fields) => ({
  key: `ship:${Math.random()}`, type: 'ship', group: 'sales', urgency: 'soon', title: 'Ship it', detail: 'PS5 · sold on eBay 4 days ago',
  due_date: null, amount: null, link: { kind: 'transaction', inventoryId: 'inv-1', saleId: 'sale-1' }, actions: ['snooze', 'dismiss'], ...fields,
});

const response = (items, hidden = []) => ({ today: localToday(), items, counts: { total: items.length }, hidden: hidden.length, hidden_items: hidden });

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname} {JSON.stringify(location.state)}</p>;
}

const mount = (element = <Todos />) => render(
  <MemoryRouter initialEntries={['/todos']}>
    <Routes>
      <Route path="/todos" element={element} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  queryState = { isError: false };
  mutate.mockReset();
  mutateAsync.mockClear();
  runAction.mockClear();
  openReminders = [];
  Object.values(reminderCalls).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('To-Do page', () => {
  it('shows an all-caught-up message when nothing needs the user', () => {
    todos = response([]);
    mount();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();
  });

  it('shows an optional Email automation card with its own count, only when there is something to confirm', () => {
    todos = response([]);
    mount();
    expect(screen.queryByRole('region', { name: /Email automation/ })).not.toBeInTheDocument();
    cleanup();
    automationToConfirm.count = 3;
    mount();
    const card = screen.getByRole('region', { name: /Email automation/ });
    expect(card).toHaveTextContent('3 changes to confirm');
    expect(card).toHaveTextContent('Optional');
    expect(screen.getByRole('link', { name: /Review changes/ })).toHaveAttribute('href', '/automation');
    // Not a to-do item: the list (and so the nav badge's count) stays empty.
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    automationToConfirm.count = 0;
  });

  it('shows a retry screen when the list fails to load', () => {
    todos = undefined;
    queryState.isError = true;
    mount();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('sorts items into urgency sections, most urgent first', () => {
    todos = response([
      entry({ key: 'dispute:1', type: 'open_dispute', urgency: 'today', title: 'Open dispute' }),
      entry({ key: 'card-due:c:2026-11-10', type: 'card_overdue', group: 'cards', urgency: 'overdue', title: 'Amex was due 2 days ago' }),
      entry({ key: 'aging:1', type: 'aging_stock', group: 'purchases', urgency: 'info', title: 'Sitting 40 days, not listed' }),
    ]);
    mount();
    const sections = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
      .filter((label) => ['Overdue', 'Today', 'This week', 'For your info'].includes(label));
    expect(sections).toEqual(['Overdue', 'Today', 'For your info']);
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('Amex was due 2 days ago')).toBeInTheDocument();
  });

  it('filters by group, showing only groups that have items', () => {
    todos = response([
      entry({ key: 'ship:1' }),
      entry({ key: 'send-tracking:1', type: 'send_tracking', group: 'cashout', title: 'Send tracking' }),
    ]);
    mount();
    const chips = within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['All2', 'Cash-outs1', 'Sales1']);
    fireEvent.click(screen.getByRole('button', { name: /^Cash-outs/ }));
    expect(screen.getByText('Send tracking')).toBeInTheDocument();
    expect(screen.queryByText('Ship it')).not.toBeInTheDocument();
  });

  it('folds three or more of one kind into an expandable row', () => {
    todos = response(['A', 'B', 'C'].map((name) => entry({ key: `ship:${name}`, detail: `${name} · sold on eBay` })));
    mount();
    const fold = screen.getByRole('button', { name: /Ship it \(3\)/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
    fireEvent.click(fold);
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3);
  });

  it('opens a purchase or sale in the Transactions window', () => {
    todos = response([entry({ key: 'ship:1' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Open Ship it/ }));
    expect(screen.getByTestId('where').textContent).toBe('/transactions {"openTransaction":{"inventoryId":"inv-1","saleId":"sale-1"}}');
  });

  it('opens a page link with its state', () => {
    todos = response([entry({ key: 'card-setup:1', type: 'card_setup', group: 'cards', title: 'Finish card setup: Amex', link: { kind: 'page', to: '/settings', state: { tab: 'datasetup' } } })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Open Finish card setup/ }));
    expect(screen.getByTestId('where').textContent).toBe('/settings {"tab":"datasetup"}');
  });

  it('marks a card bill paid for its cycle', () => {
    const key = 'card-due:card-1:2026-11-25';
    todos = response([entry({ key, type: 'card_due', group: 'cards', title: 'Pay Amex', actions: ['mark_paid', 'snooze', 'dismiss'] })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    expect(mutate).toHaveBeenCalledWith({ key, action: 'done', until: undefined }, expect.any(Object));
  });

  it('snoozes or dismisses from the Later options', () => {
    todos = response([entry({ key: 'ship:1' })]);
    mount();
    const later = screen.getByRole('button', { name: /Later/ });
    expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument();
    fireEvent.click(later);
    expect(later).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'In 3 days' }));
    expect(mutate).toHaveBeenLastCalledWith({ key: 'ship:1', action: 'snooze', until: addDays(localToday(), 3) }, expect.any(Object));
    // Picking closes the menu; open it again to dismiss.
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Later/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(mutate).toHaveBeenLastCalledWith({ key: 'ship:1', action: 'dismiss', until: undefined }, expect.any(Object));
  });

  it('only offers dismiss on items that cannot be snoozed', () => {
    todos = response([entry({ key: 'recurring:1:2026-11-23', type: 'recurring_expense', group: 'bookkeeping', title: 'Coming up: Pirate Ship', actions: ['dismiss'] })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Hide/ }));
    expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('lists snoozed and dismissed items and brings one back', () => {
    todos = response([], [entry({ key: 'dispute:9', title: 'Open dispute', state: 'snoozed', until: '2026-12-01' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Snoozed and dismissed \(1\)/ }));
    expect(screen.getByText(/Snoozed until/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bring back/ }));
    expect(mutate).toHaveBeenCalledWith({ key: 'dispute:9', action: 'restore' }, expect.any(Object));
  });
});

describe('Dashboard Needs attention card', () => {
  it('renders nothing when the list is empty', () => {
    todos = response([]);
    const { container } = mount(<TodoSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows counts by urgency, the four most urgent rows, and links to the full list', () => {
    todos = response([1, 2, 3, 4, 5].map((n) => entry({ key: `ship:${n}`, title: `Item ${n}`, urgency: n === 1 ? 'overdue' : 'soon' })));
    mount(<TodoSummary />);
    const card = screen.getByRole('region', { name: 'Needs attention' });
    const byUrgency = within(card).getByRole('list', { name: 'By urgency' });
    expect(within(byUrgency).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1 overdue', '4 this week']);
    expect(within(card).getAllByRole('button')).toHaveLength(4);
    expect(within(card).getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/todos');
    fireEvent.click(within(card).getByText('Item 1'));
    expect(screen.getByTestId('where').textContent).toContain('/transactions');
  });

  it('folds repeats of the same thing into one row with their total, which opens the list', () => {
    todos = response(['4K', '4K Select', 'HD'].map((name) => entry({
      key: `commit-pending:${name}`, type: 'commit_pending', group: 'cashout', title: 'Add tracking to commit', detail: `2× Fire TV Stick ${name} · EB`, amount: 100,
    })));
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<TodoSummary />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const row = screen.getByRole('button', { name: /Add tracking to commit/ });
    expect(row).toHaveTextContent('×3');
    expect(row).toHaveTextContent('2× Fire TV Stick 4K, 2× Fire TV Stick 4K Select, 2× Fire TV Stick HD');
    expect(row).toHaveTextContent('$300.00');
    fireEvent.click(row);
    expect(screen.getByTestId('where').textContent).toContain('/todos');
  });

  it('shows who owes money, even with nothing else on the list', () => {
    todos = { ...response([]), waiting_payments: [
      { platform_id: 'p1', name: 'TradePost', cashout: true, total: 5414.6, sales: 2, oldest_days: 14 },
      { platform_id: 'p2', name: 'EB', cashout: true, total: 649, sales: 1, oldest_days: 0 },
    ] };
    mount(<TodoSummary />);
    const owed = screen.getByRole('region', { name: 'Waiting on payment' });
    expect(owed).toHaveTextContent('$6,063.60');
    expect(within(owed).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'TradePost2 sales · oldest 14 days$5,414.60',
      'EB1 sale · oldest today$649.00',
    ]);
  });
});

const reminderEntry = (fields = {}) => entry({
  key: 'reminder:rem-1:2026-11-21', type: 'reminder', group: 'reminders', urgency: 'today', title: 'Call Amex about the credit',
  detail: 'Due today at 3:30 PM · Every month', link: null, actions: ['complete', 'snooze', 'edit'],
  reminder: { id: 'rem-1', title: 'Call Amex about the credit', notes: 'Ask for $50', due_date: '2026-11-21', due_time: '15:30', repeat: 'monthly', payment_method_id: 'card-1' },
  ...fields,
});

describe('Reminders on the To-Do page', () => {
  it('marks a reminder done with the date the user saw', () => {
    todos = response([reminderEntry()]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(reminderCalls.complete).toHaveBeenCalledWith({ id: 'rem-1', due_date: '2026-11-21' }, expect.any(Object));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('never folds reminders, even three of them', () => {
    todos = response([1, 2, 3].map((n) => reminderEntry({ key: `reminder:r${n}:2026-11-21`, title: `Reminder ${n}` })));
    mount();
    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /\(3\)/ })).not.toBeInTheDocument();
  });

  it('adds a new reminder from the form', async () => {
    todos = response([]);
    reminderCalls.create.mockResolvedValue({});
    mount();
    fireEvent.click(screen.getByRole('button', { name: /New reminder/ }));
    const dialog = screen.getByRole('dialog', { name: 'New reminder' });
    expect(within(dialog).getByLabelText('Date')).toHaveValue(localToday());

    // A title is required.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reminder' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Give the reminder a title.');
    expect(reminderCalls.create).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('What'), { target: { value: '  Restock trip to Costco ' } });
    fireEvent.change(within(dialog).getByLabelText(/Time/), { target: { value: '09:15' } });
    fireEvent.change(within(dialog).getByLabelText('Repeat'), { target: { value: 'weekly' } });
    fireEvent.change(within(dialog).getByLabelText(/About a card/), { target: { value: 'card-1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reminder' }));
    await vi.waitFor(() => expect(reminderCalls.create).toHaveBeenCalledWith({
      title: 'Restock trip to Costco', due_date: localToday(), due_time: '09:15', repeat: 'weekly', payment_method_id: 'card-1', notes: null,
    }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the server\'s error and keeps the form open when saving fails', async () => {
    todos = response([]);
    reminderCalls.create.mockRejectedValue(new Error('Card not found or access denied'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /New reminder/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('What'), { target: { value: 'Something' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add reminder' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Card not found or access denied');
  });

  it('edits a reminder from the list, prefilled, sending blanks as empty', async () => {
    todos = response([reminderEntry()]);
    reminderCalls.update.mockResolvedValue({});
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit reminder' });
    expect(within(dialog).getByLabelText('What')).toHaveValue('Call Amex about the credit');
    expect(within(dialog).getByLabelText(/Time/)).toHaveValue('15:30');
    expect(within(dialog).getByLabelText('Repeat')).toHaveValue('monthly');
    fireEvent.change(within(dialog).getByLabelText(/Notes/), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText(/Time/), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(reminderCalls.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'rem-1', notes: null, due_time: null, repeat: 'monthly' })));
  });

  it('asks a second time before deleting', async () => {
    todos = response([reminderEntry()]);
    reminderCalls.remove.mockResolvedValue({});
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(reminderCalls.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for good?' }));
    await vi.waitFor(() => expect(reminderCalls.remove).toHaveBeenCalledWith('rem-1'));
  });

  it('lists every open reminder, including ones further out, to edit', () => {
    todos = response([]);
    openReminders = [{ id: 'rem-9', title: 'Renew resale certificate', due_date: '2027-03-01', due_time: null, repeat: 'yearly', notes: null, payment_method_id: null }];
    mount();
    const panel = screen.getByRole('region', { name: /Reminders/ });
    expect(within(panel).getByText('Renew resale certificate')).toBeInTheDocument();
    expect(within(panel).getByText('Mar')).toBeInTheDocument();
    expect(within(panel).getByText(/every year/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Edit Renew resale certificate/ }));
    expect(screen.getByRole('dialog', { name: 'Edit reminder' })).toBeInTheDocument();
  });
});

describe('To-Do filters', () => {
  const mixed = () => response([
    entry({ key: 'dispute:1', type: 'open_dispute', urgency: 'today', title: 'Open dispute' }),
    entry({ key: 'aging:1', type: 'aging_stock', group: 'purchases', urgency: 'info', title: 'Sitting 40 days, not listed' }),
  ]);

  it('filters by an urgency tile, and tapping it again shows everything', () => {
    todos = mixed();
    mount();
    const tile = within(screen.getByRole('group', { name: 'Filter by urgency' })).getByRole('button', { name: /Today/ });
    fireEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Open dispute')).toBeInTheDocument();
    expect(screen.queryByText('Sitting 40 days, not listed')).not.toBeInTheDocument();
    fireEvent.click(tile);
    expect(screen.getByText('Sitting 40 days, not listed')).toBeInTheDocument();
  });

  it('offers to show everything when the filters leave nothing', () => {
    todos = mixed();
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Purchases/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by urgency' })).getByRole('button', { name: /Overdue/ }));
    expect(screen.getByText('Nothing here with these filters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
    expect(screen.getByText('Open dispute')).toBeInTheDocument();
  });

  it('links to phone notification settings', () => {
    todos = response([]);
    mount();
    fireEvent.click(screen.getByRole('link', { name: /Get these on your phone/ }));
    expect(screen.getByTestId('where').textContent).toBe('/settings {"tab":"notifications"}');
  });
});

describe('Cleaning up the list', () => {
  const saleRecord = (actions) => ({
    kind: 'sale', id: 'sale-1', quantity: 2, unit_price: 270, commission_fee: 0, sale_shipping: 0,
    workflow_status: 'WAITING_FOR_PAYMENT', workflow_type: 'STANDARD_MARKETPLACE', allowed_actions: actions,
  });

  it('folds two items that read alike and tells them apart by purchase lot', () => {
    todos = response([
      entry({ key: 'ship:a', detail: '2× Quest 3S · sold on P4D 3 days ago', lot: 'Lot bought Nov 1 · Costco' }),
      entry({ key: 'ship:b', detail: '2× Quest 3S · sold on P4D 3 days ago', lot: 'Lot bought Nov 9 · Target' }),
    ]);
    mount();
    const fold = screen.getByRole('button', { name: /Ship it \(2\)/ });
    expect(fold).toHaveTextContent('2 sales · 2× Quest 3S · sold on P4D 3 days ago');
    fireEvent.click(fold);
    expect(screen.getByText('Lot bought Nov 1 · Costco')).toBeInTheDocument();
    expect(screen.getByText('Lot bought Nov 9 · Target')).toBeInTheDocument();
  });

  it('sums the money tied up in folded aging stock and offers to hold all of it', () => {
    todos = response(['A', 'B', 'C'].map((name, index) => entry({
      key: `aging:${name}`, type: 'aging_stock', group: 'purchases', urgency: 'info',
      title: `Sitting ${40 + index} days, not listed`, detail: `${name} box`, amount: 100, actions: ['hold', 'snooze', 'dismiss'],
    })));
    mount();
    expect(screen.getByRole('button', { name: /Not listed for 30\+ days \(3\)/ })).toHaveTextContent('$300.00 tied up');
    fireEvent.click(screen.getByRole('button', { name: /All later/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Holding · 3 months' }));
    const until = addDays(localToday(), 90);
    expect(mutateAsync.mock.calls.map(([vars]) => vars)).toEqual(['A', 'B', 'C'].map((name) => ({ key: `aging:${name}`, action: 'snooze', until })));
  });

  it('runs the sale step that clears an item: Mark paid opens the payment form', () => {
    todos = response([entry({
      key: 'payout:1', type: 'payout_late', title: 'Payout late', detail: 'PS5 · eBay · no change in 9 days',
      record: saleRecord([{ action: 'mark_paid', label: 'Mark paid', requiresForm: true, secondary: false }]),
    })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Mark paid: Payout late/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('540.00')).toBeInTheDocument();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('runs a step with nothing to fill in straight away', () => {
    todos = response([entry({
      key: 'ship:1', title: 'Hand it off',
      record: saleRecord([{ action: 'mark_handed_over', label: 'Handed over', secondary: false }]),
    })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Handed over: Hand it off/ }));
    expect(runAction).toHaveBeenCalledWith('mark_handed_over', {}, expect.objectContaining({ action: 'mark_handed_over' }));
  });
});

describe('Money waiting', () => {
  it('adds up the money behind the list by kind, leaving out kinds with none', () => {
    todos = response([
      entry({ key: 'payout:1', type: 'payout_late', amount: 2707.3 }),
      entry({ key: 'payout:2', type: 'payout_late', amount: 2707.3 }),
      entry({ key: 'ship:1', type: 'ship', amount: 540 }),
      entry({ key: 'dispute:1', type: 'open_dispute', amount: null }),
    ]);
    mount();
    const box = screen.getByRole('region', { name: 'Money waiting' });
    expect(box).toHaveTextContent('$5,414.60in late payouts(2)');
    expect(box).toHaveTextContent('$540.00waiting to ship(1)');
    expect(box).not.toHaveTextContent('unlisted stock');
  });

  it('stays hidden when nothing on the list carries money', () => {
    todos = response([entry({ key: 'dispute:1', type: 'open_dispute' })]);
    mount();
    expect(screen.queryByRole('region', { name: 'Money waiting' })).not.toBeInTheDocument();
  });
});

describe('Before the push: payers, until paid, this week', () => {
  it('warns about a payer that has owed money for 3+ weeks', () => {
    todos = { ...response([]), waiting_payments: [
      { platform_id: 'p1', name: 'TradePost', cashout: true, total: 5414.6, sales: 3, oldest_days: 30, overdue_sales: 2, overdue_total: 5000 },
      { platform_id: 'p2', name: 'EB', cashout: true, total: 649, sales: 1, oldest_days: 3, overdue_sales: 0, overdue_total: 0 },
    ] };
    mount();
    const [late, fine] = within(screen.getByRole('region', { name: 'Waiting on payment' })).getAllByRole('listitem');
    expect(late).toHaveTextContent('$5,000.00 owed 3+ weeks');
    expect(fine).not.toHaveTextContent('3+ weeks');
  });

  it('hides a late payout until it is paid', () => {
    todos = response([entry({ key: 'payout:1', type: 'payout_late', title: 'Payout late', actions: ['until_paid', 'snooze', 'dismiss'] })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Later/ }));
    fireEvent.click(screen.getByRole('button', { name: "Until it's paid" }));
    expect(mutate).toHaveBeenCalledWith({ key: 'payout:1', action: 'until_paid', until: undefined }, expect.any(Object));
  });

  it('offers Until paid only where the API allows it', () => {
    todos = response([entry({ key: 'ship:1' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Later/ }));
    expect(screen.queryByRole('button', { name: "Until it's paid" })).not.toBeInTheDocument();
  });

  it('lists a payout waiting until paid under hidden items', () => {
    todos = response([entry({ key: 'ship:1' })], [entry({ key: 'payout:1', type: 'payout_late', title: 'Payout late', detail: 'PS5 · eBay', state: 'waiting', until: null })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Snoozed and dismissed/ }));
    expect(screen.getByText("Until it's paid · PS5 · eBay")).toBeInTheDocument();
  });

  it('shows what got done this week', () => {
    todos = { ...response([entry({ key: 'ship:1' })]), cleared_week: { since: '2026-11-15', payouts: 3, paid_total: 1240, sales_moved: 1, bills_paid: 0 } };
    mount();
    const week = screen.getByRole('region', { name: 'Done this week' });
    expect(within(week).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['3 payouts in$1,240.00', '1 sale moved on']);
  });

  it('says so when nothing is done yet this week', () => {
    todos = { ...response([]), cleared_week: { since: '2026-11-15', payouts: 0, paid_total: 0, sales_moved: 0, bills_paid: 0 } };
    mount();
    expect(screen.getByRole('region', { name: 'Done this week' })).toHaveTextContent('Nothing yet.');
  });
});
