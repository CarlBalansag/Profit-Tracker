// Checkpoint 2 route surface: the status-workflow action endpoints, the
// allowed_actions every GET now carries, and the shared-tracking-number dedup
// that spends one carrier request per physical package.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const statusTransitions = require('../services/statusTransitions.js');
const tracking = require('../services/tracking.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => harness.reset());
afterAll(() => server.close());

const send = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const get = (path) => send('GET', path);
const act = (kind, id, action, body) => send('POST', `/api/${kind}/${id}/actions/${action}`, body);

const names = (allowed) => (allowed || []).map((entry) => entry.action);

// The fixture rows predate the status-workflow columns, exactly like a row the
// backfill has already reached: give them a starting point for each test.
const seedInventory = (overrides = {}) => {
  Object.assign(harness.db.inventory[0], { receiving_status: 'PURCHASED', is_listed: false, ...overrides });
  return harness.db.inventory[0];
};
const seedSale = (overrides = {}) => {
  Object.assign(harness.db.sales[0], {
    workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT',
    paid_at: null, paid_amount: null, paid_reference: null, cancelled_at: null, voided_at: null,
    ...overrides,
  });
  return harness.db.sales[0];
};

describe('POST /api/inventory/:id/actions/:action', () => {
  it('performs an allowed action and returns the updated record with its new actions', async () => {
    seedInventory({ receiving_status: 'PURCHASED' });
    const res = await act('inventory', harness.ids.inventory, 'mark_on_hand');
    expect(res.status).toBe(200);
    expect(res.body.receiving_status).toBe('ON_HAND');
    expect(res.body.received_at).toBeTruthy();
    // The recomputed actions are for the record's NEW status, so no second request.
    expect(names(res.body.allowed_actions)).toEqual(['list_item', 'record_sale', 'restore_inventory', 'correct_status']);
    expect(res.body.allowed_actions).toEqual(statusTransitions.allowedActions(harness.db.inventory[0], 'inventory'));
    expect(harness.db.inventory[0].receiving_status).toBe('ON_HAND');
  });

  it('accepts a form payload and the milestone date it carries', async () => {
    seedInventory({ receiving_status: 'PURCHASED' });
    const res = await act('inventory', harness.ids.inventory, 'add_tracking', { tracking_number: ' 1Z999AA10123456784 ' });
    expect(res.status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ receiving_status: 'INBOUND', tracking_number: '1Z999AA10123456784' });

    const onHand = await act('inventory', harness.ids.inventory, 'mark_on_hand', { received_at: '2026-09-20' });
    expect(onHand.status).toBe(200);
    // Date-only input is read as local noon, like every other date in the API.
    expect(new Date(harness.db.inventory[0].received_at).toISOString()).toBe('2026-09-20T12:00:00.000Z');
  });

  it('rejects an action the record\'s current status does not allow, writing nothing', async () => {
    seedInventory({ receiving_status: 'ON_HAND' });
    const res = await act('inventory', harness.ids.inventory, 'mark_purchased');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not available/);
    expect(harness.db.inventory[0].receiving_status).toBe('ON_HAND');
  });

  it('rejects an action name that does not exist at all', async () => {
    seedInventory();
    expect((await act('inventory', harness.ids.inventory, 'teleport')).status).toBe(409);
  });

  it('rejects an incomplete form payload with 400 and no write', async () => {
    seedInventory({ receiving_status: 'PURCHASED' });
    const blank = await act('inventory', harness.ids.inventory, 'add_tracking', { tracking_number: '   ' });
    expect(blank.status).toBe(400);
    expect(harness.db.inventory[0].receiving_status).toBe('PURCHASED');

    seedInventory({ receiving_status: 'ON_HAND' });
    const outOfVocabulary = await act('inventory', harness.ids.inventory, 'correct_status', { receiving_status: 'SHIPPED_IN' });
    expect(outOfVocabulary.status).toBe(400);
    expect(harness.db.inventory[0].receiving_status).toBe('ON_HAND');
  });

  it('rejects another user\'s record id with the same 404 the other routes use', async () => {
    const foreign = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.other, product_name: 'Someone else\'s purchase', unit_purchase_cost: 10,
        qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED', receiving_status: 'PURCHASED',
      },
    });
    const res = await act('inventory', foreign.id, 'mark_on_hand');
    expect(res.status).toBe(404);
    expect(harness.db.inventory.find((i) => i.id === foreign.id).receiving_status).toBe('PURCHASED');
  });

  it('restores quantity on hand atomically and refuses a stale repeat', async () => {
    seedInventory({ receiving_status: 'ON_HAND', qty_on_hand: 3, qty_purchased: 5 });
    const ok = await act('inventory', harness.ids.inventory, 'restore_inventory', { qty_on_hand: 5, correction_note: 'Miscounted' });
    expect(ok.status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_on_hand: 5, correction_note: 'Miscounted' });

    const tooMany = await act('inventory', harness.ids.inventory, 'restore_inventory', { qty_on_hand: 9 });
    expect(tooMany.status).toBe(400);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  it('ignores a client-supplied transition clock and owner', async () => {
    seedInventory({ receiving_status: 'PURCHASED' });
    const res = await act('inventory', harness.ids.inventory, 'mark_on_hand', {
      now: '1999-01-01', user_id: harness.ids.other,
    });
    expect(res.status).toBe(200);
    expect(new Date(harness.db.inventory[0].received_at).getUTCFullYear()).toBeGreaterThan(2000);
  });

  it('leaves the legacy status column untouched', async () => {
    seedInventory({ receiving_status: 'PURCHASED' });
    expect(harness.db.inventory[0].status).toBe('PURCHASED');
    await act('inventory', harness.ids.inventory, 'mark_on_hand');
    // Checkpoint 2 does not move the legacy column from the new endpoints; no
    // live screen calls them yet, and the existing routes keep writing it.
    expect(harness.db.inventory[0].status).toBe('PURCHASED');
    expect(harness.db.inventory[0].receiving_status).toBe('ON_HAND');
  });
});

describe('POST /api/sales/:id/actions/:action', () => {
  it('records a payment from a complete Mark Paid form', async () => {
    seedSale();
    const res = await act('sales', harness.ids.sale, 'mark_paid', {
      paid_date: '2026-09-30', amount: 288, reference: 'PP-991',
    });
    expect(res.status).toBe(200);
    expect(res.body.workflow_status).toBe('PAID');
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'PAID', paid_amount: '288.00', paid_reference: 'PP-991' });
    expect(new Date(harness.db.sales[0].paid_at).toISOString()).toBe('2026-09-30T12:00:00.000Z');
    // payout_date is a user reminder and must survive a payment untouched.
    expect(harness.db.sales[0].payout_date).toBeNull();
    expect(res.body.allowed_actions).toEqual(statusTransitions.allowedActions(harness.db.sales[0], 'sale'));
  });

  it('also accepts the stored column names for the same form', async () => {
    seedSale();
    const res = await act('sales', harness.ids.sale, 'mark_paid', {
      paid_at: '2026-09-30', paid_amount: '288.00', paid_reference: 'PP-991',
    });
    expect(res.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'PAID', paid_amount: '288.00' });
  });

  it('rejects Mark Paid without a payment date or amount — there is no one-click Mark Paid', async () => {
    for (const body of [{}, { amount: 288 }, { paid_date: '2026-09-30' }, { paid_date: '2026-09-30', amount: '' }, { amount: 288, paid_date: '' }]) {
      seedSale();
      const res = await act('sales', harness.ids.sale, 'mark_paid', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'WAITING_FOR_PAYMENT', paid_at: null, paid_amount: null });
    }
    // A negative amount is not a payment either.
    seedSale();
    expect((await act('sales', harness.ids.sale, 'mark_paid', { paid_date: '2026-09-30', amount: -5 })).status).toBe(400);
    expect(harness.db.sales[0].paid_at).toBeNull();
  });

  it('rejects an action the sale\'s current status does not allow', async () => {
    seedSale({ workflow_status: 'AWAITING_SHIPMENT' });
    const res = await act('sales', harness.ids.sale, 'mark_paid', { paid_date: '2026-09-30', amount: 10 });
    expect(res.status).toBe(409);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'AWAITING_SHIPMENT', paid_at: null });
  });

  it('rejects another user\'s sale id', async () => {
    seedSale();
    harness.db.inventory[0].user_id = harness.ids.other;
    const res = await act('sales', harness.ids.sale, 'mark_paid', { paid_date: '2026-09-30', amount: 10 });
    expect(res.status).toBe(404);
    expect(harness.db.sales[0].workflow_status).toBe('WAITING_FOR_PAYMENT');
  });

  it('restores inventory atomically when a sale is voided', async () => {
    seedSale();
    harness.db.inventory[0].qty_on_hand = 3;
    const res = await act('sales', harness.ids.sale, 'void_sale');
    expect(res.status).toBe(200);
    expect(res.body.workflow_status).toBe('CANCELLED');
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
    expect(harness.db.sales[0].voided_at).toBeTruthy();
    expect(names(res.body.allowed_actions)).toEqual(['correct_status']);
  });

  it('refuses a replayed void rather than restoring the same units twice', async () => {
    seedSale();
    harness.db.inventory[0].qty_on_hand = 3;
    expect((await act('sales', harness.ids.sale, 'void_sale')).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
    // The sale is now CANCELLED, so the action is no longer on offer at all.
    expect((await act('sales', harness.ids.sale, 'void_sale')).status).toBe(409);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  // The request schema allowlists keys and strips the rest, so workflow_type
  // reaching the service at all is the thing worth asserting here.
  it('sets a workflow type and status together on a sale that had neither', async () => {
    seedSale({ workflow_type: null, workflow_status: null });
    expect(statusTransitions.allowedActions(harness.db.sales[0], 'sale'))
      .toEqual([{ action: 'correct_status', label: 'Set Sale Status', requiresForm: true, destructive: false, secondary: false, initial: true }]);

    const res = await act('sales', harness.ids.sale, 'correct_status', {
      workflow_type: 'CASHOUT', workflow_status: 'SCANNED_IN',
    });
    expect(res.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_type: 'CASHOUT', workflow_status: 'SCANNED_IN' });
    expect(names(res.body.allowed_actions)[0]).toBe('mark_accepted');
  });

  it('rejects a workflow type outside the vocabulary without writing the status', async () => {
    seedSale({ workflow_type: null, workflow_status: null });
    const res = await act('sales', harness.ids.sale, 'correct_status', {
      workflow_type: 'NOT_A_WORKFLOW', workflow_status: 'PAID',
    });
    expect(res.status).toBe(400);
    expect(harness.db.sales[0]).toMatchObject({ workflow_type: null, workflow_status: null });
  });

  it('rejects a status that belongs to a different workflow than the one chosen', async () => {
    seedSale({ workflow_type: null, workflow_status: null });
    const res = await act('sales', harness.ids.sale, 'correct_status', {
      workflow_type: 'DIRECT_LOCAL', workflow_status: 'SCANNED_IN',
    });
    expect(res.status).toBe(400);
    expect(harness.db.sales[0]).toMatchObject({ workflow_type: null, workflow_status: null });
  });
});

describe('allowed_actions on existing GET responses', () => {
  it('appears on the inventory list and on each nested sale', async () => {
    seedInventory({ receiving_status: 'ON_HAND', is_listed: true, qty_on_hand: 3 });
    seedSale({ workflow_status: 'OUTBOUND' });
    const res = await get('/api/inventory');
    expect(res.status).toBe(200);
    const item = res.body.find((row) => row.id === harness.ids.inventory);
    expect(item.allowed_actions).toEqual(statusTransitions.allowedActions(harness.db.inventory[0], 'inventory'));
    expect(names(item.allowed_actions)).toContain('record_sale');
    expect(item.sales[0].allowed_actions).toEqual(statusTransitions.allowedActions(harness.db.sales[0], 'sale'));
    expect(names(item.sales[0].allowed_actions)).toContain('check_tracking');
    // Existing fields are untouched.
    expect(item).toMatchObject({ product_name: 'QA Multi-unit Sneaker', status: 'PURCHASED', qty_on_hand: 3 });
  });

  it('appears on the inventory detail response', async () => {
    seedInventory({ receiving_status: 'INBOUND' });
    const res = await get(`/api/inventory/${harness.ids.inventory}`);
    expect(res.status).toBe(200);
    expect(names(res.body.allowed_actions)).toEqual(['check_tracking', 'mark_on_hand', 'cancel', 'correct_status']);
    expect(res.body.allowed_actions).toEqual(statusTransitions.allowedActions(harness.db.inventory[0], 'inventory'));
  });

  it('appears on the sales list', async () => {
    seedSale({ workflow_status: 'WAITING_FOR_PAYMENT' });
    const res = await get('/api/sales');
    expect(res.status).toBe(200);
    expect(res.body[0].allowed_actions).toEqual(statusTransitions.allowedActions(harness.db.sales[0], 'sale'));
    expect(names(res.body[0].allowed_actions)[0]).toBe('mark_paid');
    expect(res.body[0]).toMatchObject({ status: 'SOLD', quantity: 2, unit_price: 150 });
  });

  // Still not a guess: a row the backfill could not resolve gets exactly one
  // action, and it is the user setting the status by hand.
  it('offers a row the backfill has not reached one primary action to set its status', async () => {
    const res = await get('/api/inventory');
    const row = res.body.find((entry) => entry.id === harness.ids.inventory);
    expect(row.allowed_actions).toEqual([
      { action: 'correct_status', label: 'Set Receiving Status', requiresForm: true, destructive: false, secondary: false, initial: true },
    ]);
  });

  it('accepts that status being set, so an unresolved row is no longer stuck', async () => {
    // Explicitly null rather than an absent key: the real column exists and is
    // NULL on these rows, and the in-memory double compares values strictly
    // (undefined would not match the transition's `IS NULL` concurrency guard).
    Object.assign(harness.db.inventory[0], { receiving_status: null });
    const res = await act('inventory', harness.ids.inventory, 'correct_status', { receiving_status: 'ON_HAND' });
    expect(res.status).toBe(200);
    expect(harness.db.inventory[0].receiving_status).toBe('ON_HAND');
    expect(names(res.body.allowed_actions)).toContain('list_item');
  });
});

describe('shared tracking numbers use one carrier request', () => {
  const SHARED = '9400111899223856928499'; // the fixture number; USPS-formatted
  let realUsps;
  let calls;

  beforeEach(() => {
    // refreshTracking already takes an injectable `clients` map; this swaps the
    // one entry the shared number resolves to so the route layer needs no test
    // hook of its own.
    realUsps = tracking.LIVE_CARRIERS.USPS;
    calls = [];
    tracking.LIVE_CARRIERS.USPS = {
      isConfigured: () => true,
      trackByNumber: async (number) => {
        calls.push(number);
        return { status: 'Delivered', events: [{ date: '2026-09-25T10:00:00Z', description: 'Delivered' }], deliveredAt: '2026-09-25T10:00:00Z', estimatedDelivery: null };
      },
    };
  });

  afterEach(() => { tracking.LIVE_CARRIERS.USPS = realUsps; });

  // Two purchases and one sale, all owned by the same user, all one package.
  const seedShared = async () => {
    seedInventory({ receiving_status: 'INBOUND', tracking_number: SHARED });
    const second = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.user, product_name: 'Same box, second purchase', vendor_id: harness.ids.vendor,
        unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED',
        receiving_status: 'PURCHASED', tracking_number: SHARED,
      },
    });
    seedSale({ workflow_status: 'OUTBOUND', tracking_number: SHARED });
    return second;
  };

  it('checks the carrier once for three rows and applies the result to all of them', async () => {
    const second = await seedShared();
    const res = await send('POST', `/api/inventory/${harness.ids.inventory}/track`);
    expect(res.status).toBe(200);

    // One physical package, one carrier request — not one per row.
    expect(calls).toEqual([SHARED]);
    for (const row of [harness.db.inventory[0], harness.db.inventory.find((i) => i.id === second.id), harness.db.sales[0]]) {
      expect(row.tracking_info).toMatchObject({ carrier: 'USPS', trackable: true, status: 'Delivered' });
    }
    // The rate limit is charged once too, for the one request made.
    expect(res.body.rate_limit.remaining).toBe(9);
  });

  it('advances every eligible row of either kind along its own workflow', async () => {
    const second = await seedShared();
    await send('POST', `/api/inventory/${harness.ids.inventory}/track`);

    expect(harness.db.inventory[0]).toMatchObject({ receiving_status: 'ON_HAND' });
    expect(harness.db.inventory.find((i) => i.id === second.id)).toMatchObject({ receiving_status: 'ON_HAND' });
    expect(new Date(harness.db.inventory[0].received_at).toISOString()).toBe('2026-09-25T10:00:00.000Z');
    // The sale follows its own stored workflow, not the inventory one.
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'WAITING_FOR_PAYMENT' });
    expect(harness.db.sales[0].delivered_at).toBeTruthy();
    // The legacy status column is not moved by a carrier check, as before.
    expect(harness.db.inventory[0].status).toBe('PURCHASED');
    expect(harness.db.sales[0].status).toBe('SOLD');
  });

  it('is idempotent: a repeated check spends another request but moves nothing backward', async () => {
    await seedShared();
    await send('POST', `/api/inventory/${harness.ids.inventory}/track`);
    const second = await send('POST', `/api/inventory/${harness.ids.inventory}/track`);
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(harness.db.inventory[0].receiving_status).toBe('ON_HAND');
    expect(harness.db.sales[0].workflow_status).toBe('WAITING_FOR_PAYMENT');
  });

  it('never touches another user\'s row that happens to share the number', async () => {
    await seedShared();
    const foreign = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.other, product_name: 'Another user, same number', unit_purchase_cost: 10,
        qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED', receiving_status: 'PURCHASED', tracking_number: SHARED,
      },
    });
    await send('POST', `/api/inventory/${harness.ids.inventory}/track`);
    const row = harness.db.inventory.find((i) => i.id === foreign.id);
    expect(row.tracking_info).toBeUndefined();
    expect(row.receiving_status).toBe('PURCHASED');
  });

  it('changes no business status when the carrier is unhelpful', async () => {
    await seedShared();
    tracking.LIVE_CARRIERS.USPS.trackByNumber = async (number) => {
      calls.push(number);
      return { status: 'In Transit', events: [], deliveredAt: null, estimatedDelivery: null };
    };
    await send('POST', `/api/inventory/${harness.ids.inventory}/track`);
    expect(calls).toHaveLength(1);
    expect(harness.db.inventory[0].receiving_status).toBe('INBOUND');
    expect(harness.db.sales[0].workflow_status).toBe('OUTBOUND');
    expect(harness.db.inventory[0].tracking_info).toMatchObject({ status: 'In Transit' });
  });

  it('works the same way from the sale side of the package', async () => {
    const second = await seedShared();
    const res = await send('POST', `/api/sales/${harness.ids.sale}/track`);
    expect(res.status).toBe(200);
    expect(calls).toEqual([SHARED]);
    expect(res.body.workflow_status).toBe('WAITING_FOR_PAYMENT');
    expect(names(res.body.allowed_actions)[0]).toBe('mark_paid');
    expect(harness.db.inventory.find((i) => i.id === second.id).receiving_status).toBe('ON_HAND');
  });
});
