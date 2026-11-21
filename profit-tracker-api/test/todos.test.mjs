import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const todos = require('../services/todos.js');
const { resolveToday } = require('../routes/todos.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

// Fixture dates are relative to the real date, since the route only accepts a
// `today` within a day of the server's clock.
const TODAY = new Date().toISOString().slice(0, 10);
const day = (offset) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + offset * 86400000);
const dayStr = (offset) => day(offset).toISOString().slice(0, 10);
const dayOfMonth = (offset) => Number(dayStr(offset).slice(8, 10));

const request = async (method, path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const list = () => request('GET', `/api/todos?today=${TODAY}`);
const types = (items) => items.map((entry) => entry.type);
const byType = (items, type) => items.filter((entry) => entry.type === type);

const { ids } = harness;
const CASHOUT = '99999999-9999-4999-8999-999999999999';
const CONN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// A clean slate: one card with nothing due, the fixture purchase fully set up,
// no sales, so each test adds only what it is about.
function cleanSlate() {
  harness.reset();
  const { db } = harness;
  db.sales = [];
  db.expense = [];
  // The fixture card: due day and close day far from today.
  Object.assign(db.paymentMethod[0], { due_day: dayOfMonth(15), statement_close_day: dayOfMonth(-15) });
  Object.assign(db.inventory[0], { receiving_status: 'ON_HAND', is_listed: true, purchase_date: day(-5), tracking_number: '1Z999' });
  db.platform.push({ id: CASHOUT, user_id: ids.user, name: 'QA Cashout', type: 'Cashout', fee_pct: 0 });
  db.cashoutConnection.push({ id: CONN, user_id: ids.user, provider: 'eb', display_name: 'EB', status: 'active', platform_id: CASHOUT, last_error: null });
}

let seq = 0;
const uuid = () => `${String(++seq).padStart(8, '0')}-0000-4000-8000-000000000000`;

function addSale(fields = {}) {
  const sale = {
    id: uuid(), inventory_id: ids.inventory, platform_id: ids.platform, buyer_id: null, quantity: 1, unit_price: 150,
    commission_fee: 0, sale_shipping: 0, status: 'SOLD', sale_date: day(-1), payout_date: null, paid_at: null,
    paid_amount: null, payout_short_amount: null, refunded_amount: 0, refunded_qty: 0,
    workflow_status: 'AWAITING_SHIPMENT', workflow_status_changed_at: day(-1), tracking_info: null, ...fields,
  };
  harness.db.sales.push(sale);
  return sale;
}

function addPurchase(fields = {}) {
  const inv = {
    id: uuid(), user_id: ids.user, product_name: 'QA Purchase', vendor_id: ids.vendor, payment_method_id: ids.card,
    unit_purchase_cost: 50, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED', receiving_status: 'PURCHASED',
    purchase_date: day(-1), tracking_number: '1Z1', tracking_info: null, is_listed: false, refunded_amount: 0, refunded_qty: 0,
    created_at: new Date(), ...fields,
  };
  harness.db.inventory.push(inv);
  return inv;
}

function addCommitment(fields = {}) {
  const c = {
    id: uuid(), user_id: ids.user, connection_id: CONN, sale_id: null, external_deal_id: 'd1', external_item_id: 'i1',
    quantity: 2, status: 'active', tracking_codes: [], tracking_submitted_at: null, tracking_error: null, commit_error: null,
    created_at: new Date(), updated_at: new Date(), ...fields,
  };
  harness.db.cashoutCommitment.push(c);
  return c;
}

beforeEach(cleanSlate);

describe('GET /api/todos', () => {
  it('returns nothing when everything is in order', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.counts).toMatchObject({ total: 0, urgent: 0 });
  });

  it('requires a signed-in user', async () => {
    const res = await request('GET', '/api/todos', undefined, { 'x-qa-unauthenticated': 'true' });
    expect(res.status).toBe(401);
  });

  it('never shows another user\'s records', async () => {
    harness.db.inventory.push({ id: uuid(), user_id: ids.other, product_name: 'PRIVATE', qty_on_hand: 1, receiving_status: 'PURCHASED', purchase_date: day(-10), tracking_number: null, return_by_date: day(1), payment_method_id: null });
    harness.db.paymentMethod.push({ id: uuid(), user_id: ids.other, name: 'PRIVATE CARD', type: 'Credit', due_day: dayOfMonth(1) });
    harness.db.cashoutCommitment.push({ id: uuid(), user_id: ids.other, connection_id: CONN, status: 'active', tracking_codes: [], quantity: 1, external_item_id: 'x' });
    const res = await list();
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE');
    expect(res.body.items).toEqual([]);
  });
});

describe('cash-out items', () => {
  it('asks for tracking on an active commitment with none sent', async () => {
    const sale = addSale({ platform_id: CASHOUT, workflow_status: 'AWAITING_SHIPMENT', sale_date: day(-10), workflow_status_changed_at: day(-10) });
    addCommitment({ sale_id: sale.id });
    const { body } = await list();
    // The commitment's item replaces the plain "Ship it" one.
    expect(types(body.items)).toEqual(['send_tracking']);
    expect(body.items[0]).toMatchObject({ group: 'cashout', title: 'Send tracking', link: { kind: 'transaction', saleId: sale.id } });
  });

  it('flags failed tracking, pending commits, commits with no purchase, and closed deals', async () => {
    const a = addSale({ platform_id: CASHOUT });
    const b = addSale({ platform_id: CASHOUT, tracking_number: '1ZTRACK' });
    const c = addSale({ platform_id: CASHOUT });
    addCommitment({ sale_id: a.id, tracking_error: 'Provider said no', tracking_codes: ['1Z'] });
    addCommitment({ sale_id: b.id, status: 'pending' });
    addCommitment({ sale_id: c.id, status: 'pending', commit_error: 'Deal limit reached' });
    addCommitment({ sale_id: null });
    addCommitment({ sale_id: null, status: 'closed' });
    addCommitment({ sale_id: null, status: 'withdrawn' });
    addCommitment({ sale_id: null, status: 'expired', tracking_codes: ['1Z'], tracking_submitted_at: new Date() });
    const { body } = await list();
    expect(types(body.items).sort()).toEqual(['commit_no_purchase', 'commit_pending', 'commit_pending', 'deal_closed_unshipped', 'tracking_failed']);
    expect(byType(body.items, 'commit_pending').map((entry) => entry.title).sort()).toEqual(["Commit to the cash-out", "Couldn't commit"]);
  });

  it('flags a broken connection', async () => {
    harness.db.cashoutConnection[0].status = 'attention_needed';
    harness.db.cashoutConnection[0].last_error = 'Key rejected';
    const { body } = await list();
    expect(body.items).toEqual([expect.objectContaining({ type: 'reconnect_cashout', title: 'Reconnect EB', detail: 'Key rejected' })]);
  });

  it('flags units not scanned in and cash-out payments that are late', async () => {
    addSale({ platform_id: CASHOUT, workflow_status: 'DELIVERED_TO_PROVIDER', workflow_status_changed_at: day(-6) });
    addSale({ platform_id: CASHOUT, workflow_status: 'WAITING_FOR_SCAN_IN', workflow_status_changed_at: day(-2) });
    addSale({ platform_id: CASHOUT, workflow_status: 'SCANNED_IN', workflow_status_changed_at: day(-8) });
    addSale({ platform_id: CASHOUT, workflow_status: 'ACCEPTED', workflow_status_changed_at: day(-3) });
    const { body } = await list();
    expect(types(body.items).sort()).toEqual(['not_scanned_in', 'payout_late']);
    expect(byType(body.items, 'payout_late')[0]).toMatchObject({ group: 'cashout', title: 'Cash-out payment late' });
  });
});

describe('sale items', () => {
  it('flags an unshipped sale after 3 days, overdue after 7', async () => {
    addSale({ workflow_status_changed_at: day(-2), sale_date: day(-2) });
    const late = addSale({ workflow_status_changed_at: day(-4), sale_date: day(-4) });
    const later = addSale({ workflow_status: 'AWAITING_HANDOFF', workflow_status_changed_at: day(-8), sale_date: day(-8) });
    const { body } = await list();
    expect(body.items.map((entry) => [entry.key, entry.urgency, entry.title])).toEqual([
      [`ship:${later.id}`, 'overdue', 'Hand it off'],
      [`ship:${late.id}`, 'soon', 'Ship it'],
    ]);
  });

  it('reads the legacy status when the workflow status is empty', async () => {
    addSale({ workflow_status: null, status: 'SOLD', workflow_status_changed_at: null, sale_date: day(-5) });
    const { body } = await list();
    expect(types(body.items)).toEqual(['ship']);
  });

  it('flags a delivered sale whose status was never moved', async () => {
    addSale({ workflow_status: 'OUTBOUND', tracking_info: { trackable: true, status: 'Delivered' } });
    addSale({ workflow_status: 'OUTBOUND', tracking_info: { trackable: true, status: 'In Transit' } });
    const { body } = await list();
    expect(types(body.items)).toEqual(['sale_delivered']);
  });

  it('flags a payout past its expected date or the buyer\'s usual time, never a paid sale', async () => {
    const buyer = { id: uuid(), user_id: ids.user, name: 'Bob', avg_days_to_payout: 3 };
    harness.db.buyer.push(buyer);
    const byDate = addSale({ workflow_status: 'WAITING_FOR_PAYMENT', payout_date: day(-1), unit_price: 100, quantity: 2 });
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', payout_date: day(2) });
    const byBuyer = addSale({ workflow_status: 'WAITING_FOR_PAYMENT', buyer_id: buyer.id, sale_date: day(-5) });
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', payout_date: day(-3), paid_at: day(-1), paid_amount: 150 });
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', workflow_status_changed_at: day(-2), sale_date: day(-2) });
    const { body } = await list();
    const late = byType(body.items, 'payout_late');
    expect(late.map((entry) => entry.key).sort()).toEqual([`payout:${byBuyer.id}`, `payout:${byDate.id}`].sort());
    expect(late.find((entry) => entry.key === `payout:${byDate.id}`)).toMatchObject({ urgency: 'overdue', amount: 200, due_date: dayStr(-1) });
  });

  it('flags short-paid sales, open returns and disputes, and skips voided ones', async () => {
    addSale({ workflow_status: 'PAID', paid_at: day(-1), paid_amount: 100, payout_short_amount: 40 });
    addSale({ workflow_status: 'RETURN_IN_PROGRESS' });
    addSale({ workflow_status: 'DISPUTED' });
    addSale({ workflow_status: 'DISPUTED', voided_at: day(-1) });
    const { body } = await list();
    // Same urgency, no due date: the one with money on it comes first.
    expect(types(body.items)).toEqual(['open_dispute', 'short_paid', 'open_return']);
    expect(byType(body.items, 'short_paid')[0]).toMatchObject({ title: 'Short-paid $40.00', amount: 40 });
  });

  it('carries the sale action that clears the item, so it can be done right there', async () => {
    addSale({ workflow_status: 'AWAITING_SHIPMENT', workflow_status_changed_at: day(-4) });
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', workflow_status_changed_at: day(-10), unit_price: 200, quantity: 2 });
    const { body } = await list();
    const ship = byType(body.items, 'ship')[0];
    expect(ship.stale).toBe(false);
    expect(ship.record).toMatchObject({ kind: 'sale', workflow_status: 'AWAITING_SHIPMENT' });
    expect(ship.record.allowed_actions.map((a) => [a.action, a.label])).toEqual([['add_outbound_tracking', 'Add tracking']]);
    expect(ship.lot).toMatch(/^Lot bought /);
    const payout = byType(body.items, 'payout_late')[0];
    expect(payout.record).toMatchObject({ unit_price: 200, quantity: 2 });
    expect(payout.record.allowed_actions.map((a) => a.action)).toEqual(['mark_paid']);
    expect(payout.detail).toMatch(/no change in 10 days · sold /);
  });

  it('offers to fix the status of a sale stuck unshipped for months', async () => {
    addSale({ workflow_status: 'AWAITING_SHIPMENT', sale_date: day(-120), workflow_status_changed_at: day(-120) });
    const { body } = await list();
    const [ship] = byType(body.items, 'ship');
    expect(ship).toMatchObject({ urgency: 'overdue', stale: true });
    expect(ship.detail).toMatch(/already done\? Fix its status$/);
    expect(ship.record.allowed_actions.map((a) => a.action)).toEqual(['add_outbound_tracking', 'correct_status']);
    expect(ship.record.allowed_actions.every((a) => a.secondary === false)).toBe(true);
  });

  it('gives old rows from before the status workflow no inline action', async () => {
    addSale({ workflow_status: null, status: 'SOLD', workflow_status_changed_at: day(-4) });
    const { body } = await list();
    expect(byType(body.items, 'ship')[0].record).toBeNull();
  });
});

describe('purchase items', () => {
  it('flags delivered purchases, missing tracking, old pre-orders and aging stock', async () => {
    addPurchase({ receiving_status: 'INBOUND', tracking_info: { trackable: true, status: 'Delivered' } });
    addPurchase({ tracking_number: null, purchase_date: day(-3) });
    addPurchase({ tracking_number: null, purchase_date: day(-1) }); // too new
    addPurchase({ tracking_number: null, purchase_date: day(-3), qty_on_hand: 0 }); // nothing left to receive
    addPurchase({ tracking_number: null, purchase_date: day(-90) }); // too old to chase
    addPurchase({ receiving_status: 'PRE_ORDER', purchase_date: day(-31) });
    addPurchase({ receiving_status: 'ON_HAND', purchase_date: day(-40), received_date: day(-35) });
    addPurchase({ receiving_status: 'ON_HAND', purchase_date: day(-40), received_date: day(-10) });
    addPurchase({ receiving_status: 'ON_HAND', purchase_date: day(-40), is_listed: true });
    addPurchase({ receiving_status: 'ON_HAND', purchase_date: day(-40), cancelled_at: day(-1), tracking_number: null });
    const { body } = await list();
    expect(types(body.items).sort()).toEqual(['aging_stock', 'mark_received', 'pre_order', 'purchase_tracking']);
    expect(byType(body.items, 'aging_stock')[0].title).toBe('Sitting 35 days, not listed');
    expect(byType(body.items, 'aging_stock')[0]).toMatchObject({ amount: 50, actions: ['hold', 'snooze', 'dismiss'] });
  });

  it('flags a closing return window only while units are unsold', async () => {
    const soon = addPurchase({ receiving_status: 'ON_HAND', is_listed: true, return_by_date: day(1), qty_on_hand: 2 });
    addPurchase({ receiving_status: 'ON_HAND', is_listed: true, return_by_date: day(1), qty_on_hand: 0 });
    addPurchase({ receiving_status: 'ON_HAND', is_listed: true, return_by_date: day(5) });
    addPurchase({ receiving_status: 'ON_HAND', is_listed: true, return_by_date: day(-1) });
    const { body } = await list();
    expect(body.items).toEqual([expect.objectContaining({
      key: `return-window:${soon.id}:${dayStr(1)}`, urgency: 'today', title: 'Return window closes tomorrow', detail: '2 unsold · QA Purchase · QA Store',
    })]);
  });

  it('flags a recent purchase with no card', async () => {
    addPurchase({ payment_method_id: null, receiving_status: 'ON_HAND', is_listed: true });
    addPurchase({ payment_method_id: null, receiving_status: 'ON_HAND', is_listed: true, purchase_date: day(-100) });
    const { body } = await list();
    expect(body.items).toEqual([expect.objectContaining({ type: 'missing_card', group: 'cards' })]);
  });
});

describe('card items', () => {
  it('asks to pay a card due within 3 days, with a mark-paid action', async () => {
    harness.db.paymentMethod[0].due_day = dayOfMonth(2);
    const { body } = await list();
    const due = dayStr(2);
    // Days 29-31 don't exist in every month, so only assert when the due day
    // maps back onto the same date.
    if (Number(due.slice(8, 10)) <= 28) {
      expect(body.items).toEqual([expect.objectContaining({
        key: `card-due:${ids.card}:${due}`, type: 'card_due', urgency: 'soon', title: 'Pay QA Credit Card', actions: ['mark_paid', 'snooze', 'dismiss'],
      })]);
    }
  });

  it('flags a card due a few days ago as overdue until it is marked paid', async () => {
    harness.db.paymentMethod[0].due_day = dayOfMonth(-2);
    const first = await list();
    const key = `card-due:${ids.card}:${dayStr(-2)}`;
    if (Number(dayStr(-2).slice(8, 10)) > 28) return;
    expect(first.body.items).toEqual([expect.objectContaining({ key, type: 'card_overdue', urgency: 'overdue' })]);

    const paid = await request('POST', '/api/todos/state', { key, action: 'done', today: TODAY });
    expect(paid).toMatchObject({ status: 200, body: { key, state: 'done', until: null } });
    const after = await list();
    expect(after.body.items).toEqual([]);
    expect(after.body.hidden).toBe(1);
    expect(after.body.hidden_items).toEqual([]); // paid is done, not "bring back"
  });

  it('asks once to finish setting up the cards in use that are missing their bill dates', async () => {
    Object.assign(harness.db.paymentMethod[0], { due_day: null, credit_limit: null });
    const { body } = await list();
    expect(body.items).toEqual([expect.objectContaining({
      type: 'card_setup',
      title: 'Finish card setup: QA Credit Card',
      detail: 'QA Credit Card · add the due day and statement close day so bill reminders work',
    })]);
  });

  it('leaves alone a card missing only its limit, or one not used in 90 days', async () => {
    harness.db.paymentMethod[0].credit_limit = null;
    expect((await list()).body.items).toEqual([]);
    Object.assign(harness.db.paymentMethod[0], { due_day: null });
    harness.db.inventory[0].purchase_date = day(-100);
    expect((await list()).body.items).toEqual([]);
  });

  it('folds several unfinished cards into one item whose key follows the set of cards', async () => {
    harness.db.paymentMethod[0].due_day = null;
    const second = { ...harness.db.paymentMethod[0], id: uuid(), name: 'Another Card', due_day: null };
    harness.db.paymentMethod.push(second);
    addPurchase({ payment_method_id: second.id, is_listed: true, receiving_status: 'ON_HAND' });
    const first = (await list()).body.items.filter((entry) => entry.type === 'card_setup');
    expect(first).toEqual([expect.objectContaining({ title: 'Finish setup on 2 cards' })]);
    expect(first[0].detail).toMatch(/^Another Card, QA Credit Card · /);

    await request('POST', '/api/todos/state', { key: first[0].key, action: 'dismiss', today: TODAY });
    expect((await list()).body.items.filter((entry) => entry.type === 'card_setup')).toEqual([]);
    // A third card joins: a new item, not hidden by the old dismiss.
    const third = { ...harness.db.paymentMethod[0], id: uuid(), name: 'Third Card', due_day: null };
    harness.db.paymentMethod.push(third);
    addPurchase({ payment_method_id: third.id, is_listed: true, receiving_status: 'ON_HAND' });
    const later = (await list()).body.items.filter((entry) => entry.type === 'card_setup');
    expect(later).toEqual([expect.objectContaining({ title: 'Finish setup on 3 cards' })]);
    expect(later[0].key).not.toBe(first[0].key);
  });

  it('warns about a statement closing soon, or to pay down a card over 30% before it closes', async () => {
    harness.db.paymentMethod[0].statement_close_day = dayOfMonth(2);
    if (dayOfMonth(2) > 28) return;
    const quiet = await list();
    expect(types(quiet.body.items)).toEqual(['statement_closes']);

    // $1,600 of this month's purchases on a $5,000 limit = 32%.
    addPurchase({ purchase_date: day(0), unit_purchase_cost: 1600, receiving_status: 'ON_HAND', is_listed: true });
    harness.db.inventory[0].purchase_date = day(-400);
    const busy = await list();
    expect(types(busy.body.items)).toEqual(['card_pay_down']);
    expect(busy.body.items[0].detail).toMatch(/^32% of the limit/);
  });
});

describe('bookkeeping items', () => {
  it('lists a recurring expense coming up in the next 3 days', async () => {
    harness.db.recurringExpense.push(
      { id: uuid(), user_id: ids.user, name: 'Pirate Ship', amount: 20, frequency: 'weekly', start_date: day(-5), end_date: null, active: true },
      { id: uuid(), user_id: ids.user, name: 'Far off', amount: 20, frequency: 'weekly', start_date: day(-1), end_date: null, active: true },
      { id: uuid(), user_id: ids.user, name: 'Ended', amount: 20, frequency: 'weekly', start_date: day(-5), end_date: day(0), active: true },
      { id: uuid(), user_id: ids.user, name: 'Paused', amount: 20, frequency: 'weekly', start_date: day(-5), end_date: null, active: false },
    );
    const { body } = await list();
    expect(body.items).toEqual([expect.objectContaining({ type: 'recurring_expense', title: 'Coming up: Pirate Ship', due_date: dayStr(2), amount: 20 })]);
  });
});

describe('snooze, dismiss and undo', () => {
  it('snoozes an item until a date, then shows it again', async () => {
    const sale = addSale({ workflow_status: 'DISPUTED' });
    const key = `dispute:${sale.id}`;
    const snoozed = await request('POST', '/api/todos/state', { key, action: 'snooze', until: dayStr(3), today: TODAY });
    expect(snoozed).toMatchObject({ status: 200, body: { state: 'snoozed', until: dayStr(3) } });
    const hidden = await list();
    expect(hidden.body.items).toEqual([]);
    expect(hidden.body.hidden_items).toEqual([expect.objectContaining({ key, state: 'snoozed', until: dayStr(3) })]);

    // Snoozing again updates the same row rather than adding one.
    await request('POST', '/api/todos/state', { key, action: 'snooze', until: dayStr(1), today: TODAY });
    expect(harness.db.todoState).toHaveLength(1);
    expect(todos.isHidden(harness.db.todoState[0], dayStr(1))).toBe(false);

    const undone = await request('DELETE', `/api/todos/state?key=${encodeURIComponent(key)}`);
    expect(undone).toMatchObject({ status: 200, body: { restored: true } });
    expect(types((await list()).body.items)).toEqual(['open_dispute']);
  });

  it('dismisses an item for good', async () => {
    const sale = addSale({ workflow_status: 'RETURN_IN_PROGRESS' });
    await request('POST', '/api/todos/state', { key: `return:${sale.id}`, action: 'dismiss', today: TODAY });
    expect((await list()).body.items).toEqual([]);
  });

  it('rejects bad keys, actions and snooze dates without writing', async () => {
    const bad = await Promise.all([
      request('POST', '/api/todos/state', { key: 'nope', action: 'dismiss' }),
      request('POST', '/api/todos/state', { key: 'ship:abc', action: 'explode' }),
      request('POST', '/api/todos/state', { key: 'ship:abc', action: 'snooze' }),
      request('POST', '/api/todos/state', { key: 'ship:abc', action: 'snooze', until: TODAY, today: TODAY }),
      request('POST', '/api/todos/state', { key: 'ship:abc', action: 'snooze', until: dayStr(400), today: TODAY }),
      request('POST', '/api/todos/state', { key: 'ship:abc', action: 'dismiss', extra: true }),
      request('DELETE', '/api/todos/state?key=%3Cscript%3E'),
    ]);
    expect(bad.map((res) => res.status)).toEqual([400, 400, 400, 400, 400, 400, 400]);
    expect(harness.db.todoState).toHaveLength(0);
  });

  it('keeps each user\'s states separate', async () => {
    harness.db.todoState.push({ id: uuid(), user_id: ids.other, key: 'dispute:shared', state: 'dismissed', until: null });
    const undone = await request('DELETE', '/api/todos/state?key=dispute:shared');
    expect(undone.body.restored).toBe(false);
    expect(harness.db.todoState).toHaveLength(1);
  });

  it('keeps the stored records untouched when saving a state fails', async () => {
    harness.faults['todoState.upsert'] = true;
    const res = await request('POST', '/api/todos/state', { key: 'ship:abc', action: 'dismiss' });
    expect(res.status).toBe(500);
    expect(harness.db.todoState).toHaveLength(0);
  });

  it('requires a signed-in user to save a state', async () => {
    const res = await request('POST', '/api/todos/state', { key: 'ship:abc', action: 'dismiss' }, { 'x-qa-unauthenticated': 'true' });
    expect(res.status).toBe(401);
  });
});

describe('date helpers', () => {
  it('only trusts a device date within a day of the server', () => {
    expect(resolveToday(TODAY)).toBe(TODAY);
    expect(resolveToday(dayStr(-1))).toBe(dayStr(-1));
    expect(resolveToday(dayStr(5))).toBe(TODAY);
    expect(resolveToday('2026-02-30')).toBe(TODAY);
    expect(resolveToday(undefined)).toBe(TODAY);
  });

  it('clamps monthly days to short months', () => {
    expect(todos.monthlyDates(31, '2026-02-10')).toEqual({ next: '2026-02-28', previous: '2026-01-31' });
    expect(todos.monthlyDates(10, '2026-12-11')).toEqual({ next: '2027-01-10', previous: '2026-12-10' });
    expect(todos.monthlyDates(10, '2026-12-10')).toEqual({ next: '2026-12-10', previous: '2026-11-10' });
  });

  it('steps recurring expenses from their start date', () => {
    expect(todos.nextRecurringDate({ frequency: 'monthly', start_date: '2026-01-31' }, '2026-02-15')).toBe('2026-02-28');
    expect(todos.nextRecurringDate({ frequency: 'biweekly', start_date: '2026-11-01' }, '2026-11-16')).toBe('2026-11-29');
    expect(todos.nextRecurringDate({ frequency: 'weekly', start_date: '2026-12-01' }, '2026-11-20')).toBe('2026-12-01');
  });
});

describe('money and escalation', () => {
  it('puts the sale value on items about a sale', async () => {
    addSale({ workflow_status: 'AWAITING_SHIPMENT', workflow_status_changed_at: day(-4), unit_price: 120, quantity: 3 });
    const { body } = await list();
    expect(byType(body.items, 'ship')[0].amount).toBe(360);
  });

  it('moves a late payout with no expected date to overdue after three weeks', async () => {
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', workflow_status_changed_at: day(-10) });
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', workflow_status_changed_at: day(-21) });
    const { body } = await list();
    expect(byType(body.items, 'payout_late').map((entry) => entry.urgency).sort()).toEqual(['overdue', 'soon']);
  });

  it('notes late payouts on a card bill coming due', async () => {
    harness.db.paymentMethod[0].due_day = dayOfMonth(2);
    if (dayOfMonth(2) > 28) return;
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', workflow_status_changed_at: day(-10), unit_price: 300 });
    addSale({ workflow_status: 'WAITING_FOR_PAYMENT', workflow_status_changed_at: day(-12), unit_price: 150.5 });
    const { body } = await list();
    const [bill] = byType(body.items, 'card_due');
    expect(bill.detail).toMatch(/ · \$450\.50 in late payouts not in yet \(2\)$/);
    expect(bill.payouts_out).toBe(450.5);
  });

  it('leaves a card bill alone when no payout is late', async () => {
    harness.db.paymentMethod[0].due_day = dayOfMonth(2);
    if (dayOfMonth(2) > 28) return;
    const { body } = await list();
    expect(byType(body.items, 'card_due')[0].detail).not.toMatch(/late payouts/);
  });
});
