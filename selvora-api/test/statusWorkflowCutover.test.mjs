// Checkpoint 2 cutover guard: the status-workflow service must cover everything
// the retired services/statusHierarchy.js auto-advance engine did, and the
// legacy -> new status mappings the create routes use must agree with the ones
// scripts/migrateStatusWorkflow.js applies to historical rows.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const {
  LEGACY_AUTO_SHIP,
  LEGACY_TO_RECEIVING_STATUS,
  LEGACY_TO_WORKFLOW_STATUS,
  legacyReceivingPatch,
  legacyWorkflowStatus,
  resolveSaleWorkflow,
  trackingAttached,
} = require('../services/statusTransitions.js');
const { mapInventoryRow, mapSaleRow, LEGACY_INVENTORY_STATUSES, LEGACY_SALE_STATUSES } =
  require('../scripts/migrateStatusWorkflow.js');

beforeEach(() => harness.reset());

// The retired engine's complete behavior, frozen here as a literal so this test
// still pins it once services/statusHierarchy.js is deleted. Every legacy status
// in the vocabulary is listed, including the ones that never advanced.
const RETIRED_AUTO_SHIPPED_STATUS = {
  inbound: {
    'Pre Order': 'SHIPPED_IN',
    PURCHASED: 'SHIPPED_IN',
    'On Hand': null, SHIPPED_IN: null, DELIVERED: null, SCANNED_IN: null, LISTED: null,
    SOLD: null, SHIPPED_OUT: null, AUTHENTICATION: null, PAID: null, COMPLETED: null,
    RETURNED: null, DISPUTED: null, CANCELLED: null,
  },
  outbound: {
    SOLD: 'SHIPPED_OUT',
    SHIPPED_OUT: null, AUTHENTICATION: null, PAID: null, COMPLETED: null,
    RETURNED: null, DISPUTED: null, CANCELLED: null,
  },
};

describe('retired statusHierarchy table', () => {
  // Written and run against the real services/statusHierarchy.js before that
  // file was deleted (it reproduced the table above exactly, including every
  // status that never advanced), then frozen here as the spec the replacement
  // must satisfy.
  it('is carried verbatim into statusTransitions so the legacy column still advances', () => {
    expect(LEGACY_AUTO_SHIP.inventory).toEqual({ from: ['Pre Order', 'PURCHASED'], to: 'SHIPPED_IN' });
    expect(LEGACY_AUTO_SHIP.sale).toEqual({ from: ['SOLD'], to: 'SHIPPED_OUT' });
  });
});

// `kind` naming differs on purpose: the retired engine spoke of inbound/outbound
// packages, the registry speaks of inventory/sale records.
const KINDS = [
  { legacyKind: 'inbound', kind: 'inventory', newColumn: 'receiving_status', advancedTo: 'INBOUND' },
  { legacyKind: 'outbound', kind: 'sale', newColumn: 'workflow_status', advancedTo: 'OUTBOUND' },
];

describe('tracking-attached auto-advance parity', () => {
  // The new service writes receiving_status/workflow_status, which are different
  // columns from the legacy `status` the old engine wrote, so "equivalent" here
  // means: it fires under exactly the same trigger condition. Each legacy status
  // is translated to its new-column equivalent with the same mapping the backfill
  // uses, then both engines are asked about the same row.
  it.each(KINDS)('fires for exactly the $legacyKind statuses the retired engine advanced', ({ legacyKind, kind, newColumn, advancedTo }) => {
    const legacyStatuses = Object.keys(RETIRED_AUTO_SHIPPED_STATUS[legacyKind]);
    let fired = 0;

    for (const legacyStatus of legacyStatuses) {
      const legacyFires = RETIRED_AUTO_SHIPPED_STATUS[legacyKind][legacyStatus] !== null;
      const record = kind === 'inventory'
        ? { status: legacyStatus, qty_on_hand: 1, is_listed: false, ...legacyReceivingPatch(legacyStatus) }
        : {
          status: legacyStatus, quantity: 1, workflow_type: 'STANDARD_MARKETPLACE',
          workflow_status: legacyWorkflowStatus(legacyStatus, 'STANDARD_MARKETPLACE'),
        };

      const result = trackingAttached(kind, record, '1Z999AA10123456784');
      const newFires = Object.keys(result.data).length > 0;

      expect(newFires, `${kind}/${legacyStatus}: new service fired=${newFires}, retired engine fired=${legacyFires}`).toBe(legacyFires);
      if (legacyFires) {
        expect(result.data[newColumn]).toBe(advancedTo);
        // The legacy column must keep advancing to exactly the old value too.
        expect(result.legacy_status).toBe(RETIRED_AUTO_SHIPPED_STATUS[legacyKind][legacyStatus]);
        fired += 1;
      } else {
        expect(result.legacy_status).toBeNull();
      }
    }
    expect(fired).toBe(kind === 'inventory' ? 2 : 1);
  });

  it('fires for PRE_ORDER too, which the retired inbound engine also advanced', () => {
    const preOrder = trackingAttached('inventory', { status: 'Pre Order', receiving_status: 'PRE_ORDER', qty_on_hand: 1 }, 'T1');
    expect(preOrder).toEqual({ legacy_status: 'SHIPPED_IN', data: { receiving_status: 'INBOUND' } });
  });

  it('advances the legacy column even for a row the backfill has not reached yet', () => {
    // No receiving_status at all: the registry offers nothing, but the legacy
    // column must still move exactly as it does on main today.
    const unmigrated = trackingAttached('inventory', { status: 'PURCHASED', qty_on_hand: 1 }, 'T1');
    expect(unmigrated).toEqual({ legacy_status: 'SHIPPED_IN', data: {} });
  });

  it('does nothing without a tracking number, or for an unknown kind', () => {
    for (const blank of [undefined, null, '', '   ']) {
      expect(trackingAttached('inventory', { status: 'PURCHASED', receiving_status: 'PURCHASED' }, blank))
        .toEqual({ legacy_status: null, data: {} });
    }
    expect(trackingAttached('expense', { status: 'PURCHASED' }, 'T1')).toEqual({ legacy_status: null, data: {} });
  });

  it('uses the handoff path for a DIRECT_LOCAL sale, which the legacy vocabulary could not express', () => {
    const local = { status: 'SOLD', quantity: 1, workflow_type: 'DIRECT_LOCAL', workflow_status: 'AWAITING_HANDOFF' };
    // AWAITING_HANDOFF has no outbound tracking step, so the registry correctly
    // declines while the legacy column still advances as it always did.
    expect(trackingAttached('sale', local, 'T1')).toEqual({ legacy_status: 'SHIPPED_OUT', data: {} });
  });
});

describe('legacy -> new status mapping agrees with the backfill script', () => {
  it('maps every inventory status the backfill maps, and nothing it calls ambiguous', () => {
    for (const legacyStatus of LEGACY_INVENTORY_STATUSES) {
      // One linked sale, so the backfill's sale-only rules are reachable; the
      // create routes have no such evidence and must therefore map nothing.
      const decision = mapInventoryRow({ id: 'i', status: legacyStatus, qty_on_hand: 1, received_date: null, sales: [{ id: 's' }] });
      const patch = legacyReceivingPatch(legacyStatus);
      if (!LEGACY_TO_RECEIVING_STATUS[legacyStatus]) {
        expect(patch, legacyStatus).toEqual({});
        continue;
      }
      expect(decision.ambiguous, legacyStatus).toBe(false);
      expect(patch.receiving_status, legacyStatus).toBe(decision.data.receiving_status);
      if (legacyStatus === 'LISTED') expect(patch.is_listed).toBe(decision.data.is_listed);
    }
  });

  it('maps every sale status the backfill maps, and leaves COMPLETED alone', () => {
    for (const legacyStatus of LEGACY_SALE_STATUSES) {
      const decision = mapSaleRow({ id: 's', status: legacyStatus, payout_date: null, platform: { type: 'Marketplace' } });
      const mapped = legacyWorkflowStatus(legacyStatus, 'STANDARD_MARKETPLACE');
      if (!LEGACY_TO_WORKFLOW_STATUS[legacyStatus]) {
        expect(mapped, legacyStatus).toBeNull();
        continue;
      }
      if (legacyStatus === 'AUTHENTICATION') {
        // The backfill forces AUTH_MARKETPLACE on this status; a standard
        // workflow has no authenticating step, so the mapping declines.
        expect(mapped).toBeNull();
        expect(legacyWorkflowStatus(legacyStatus, 'AUTH_MARKETPLACE')).toBe(decision.data.workflow_status);
        continue;
      }
      expect(decision.ambiguous, legacyStatus).toBe(false);
      expect(mapped, legacyStatus).toBe(decision.data.workflow_status);
    }
    expect(legacyWorkflowStatus('COMPLETED', 'STANDARD_MARKETPLACE')).toBeNull();
    expect(legacyWorkflowStatus('not a status', 'STANDARD_MARKETPLACE')).toBeNull();
  });

  it('translates the ship-out path onto each workflow\'s own wording', () => {
    expect(legacyWorkflowStatus('SOLD', 'DIRECT_LOCAL')).toBe('AWAITING_HANDOFF');
    expect(legacyWorkflowStatus('SHIPPED_OUT', 'DIRECT_LOCAL')).toBe('HANDED_OVER');
    expect(legacyWorkflowStatus('SOLD', 'CASHOUT')).toBe('AWAITING_SHIPMENT');
    expect(legacyWorkflowStatus('PAID', 'DIRECT_LOCAL')).toBe('PAID');
    expect(legacyWorkflowStatus('CANCELLED', 'DIRECT_LOCAL')).toBe('CANCELLED');
  });

  it('falls back to the standard workflow for an unknown or missing preset', () => {
    for (const preset of [undefined, null, '', 'MADE_UP']) {
      expect(resolveSaleWorkflow(preset)).toBe('STANDARD_MARKETPLACE');
    }
    expect(resolveSaleWorkflow('CASHOUT')).toBe('CASHOUT');
  });
});

// --- Route-level cutover ----------------------------------------------------
// Every scenario the deleted test/statusAutoAdvance.test.mjs covered, now
// asserting BOTH columns: the legacy `status` must still be written exactly as
// it was before the cutover (every live screen reads it), and the new
// receiving_status/workflow_status must advance alongside it.

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

const send = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const put = (path, body) => send('PUT', path, body);
const post = (path, body) => send('POST', path, body);

const UPS = '1Z999AA10123456784';
const FEDEX = '999999999999';

describe('inbound auto-advance through the transition service', () => {
  it('advances both columns when a tracking number is first added', async () => {
    const created = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.user, product_name: 'Fresh inbound', vendor_id: harness.ids.vendor,
        unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED', receiving_status: 'PURCHASED',
      },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_IN');
    expect(harness.db.inventory.find((i) => i.id === created.id)).toMatchObject({
      status: 'SHIPPED_IN', receiving_status: 'INBOUND', tracking_number: UPS,
    });
  });

  it('advances PRE_ORDER too, the other status the retired engine handled', async () => {
    const created = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.user, product_name: 'Preordered', vendor_id: harness.ids.vendor,
        unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'Pre Order', receiving_status: 'PRE_ORDER',
      },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
    expect(res.status).toBe(200);
    expect(harness.db.inventory.find((i) => i.id === created.id)).toMatchObject({
      status: 'SHIPPED_IN', receiving_status: 'INBOUND',
    });
  });

  it('still advances the legacy column for a row the backfill has not reached', async () => {
    const created = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.user, product_name: 'Unmigrated', vendor_id: harness.ids.vendor,
        unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED',
      },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_IN');
    expect(harness.db.inventory.find((i) => i.id === created.id).receiving_status).toBeUndefined();
  });

  // A first-time tracking number on a purchase that has already arrived is now
  // rejected outright rather than silently stored without advancing anything --
  // see the "first-time tracking number is gated" suite below.
  it('rejects a first tracking number on a status that is already further along', async () => {
    const created = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.user, product_name: 'Already completed', vendor_id: harness.ids.vendor,
        unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'COMPLETED', receiving_status: 'ON_HAND',
      },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
    expect(res.status).toBe(400);
    const row = harness.db.inventory.find((i) => i.id === created.id);
    expect(row.status).toBe('COMPLETED');
    expect(row.receiving_status).toBe('ON_HAND');
    expect(row.tracking_number).toBeUndefined();
  });

  it('respects an explicit status change in the same request instead of auto-advancing', async () => {
    const created = await harness.prisma.inventory.create({
      data: {
        user_id: harness.ids.user, product_name: 'Explicit status', vendor_id: harness.ids.vendor,
        unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED', receiving_status: 'PURCHASED',
      },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS, status: 'CANCELLED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(harness.db.inventory.find((i) => i.id === created.id).receiving_status).toBe('PURCHASED');
  });

  it('does not re-advance when a tracking number is merely edited, not newly added', async () => {
    // The default fixture item already has a tracking_number and stays PURCHASED.
    harness.db.inventory[0].receiving_status = 'PURCHASED';
    const res = await put(`/api/inventory/${harness.ids.inventory}`, { tracking_number: UPS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PURCHASED');
    expect(harness.db.inventory[0].receiving_status).toBe('PURCHASED');
  });

  it('advances a brand-new item created with a tracking number already set', async () => {
    const res = await post('/api/inventory', {
      product_name: 'Created with tracking', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 1, tracking_number: UPS,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_IN');
    expect(res.body.receiving_status).toBe('INBOUND');
  });

  it('respects an explicit status at creation instead of auto-advancing', async () => {
    const res = await post('/api/inventory', {
      product_name: 'Explicit at creation', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 1, tracking_number: UPS, status: 'Pre Order',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Pre Order');
    expect(res.body.receiving_status).toBe('PRE_ORDER');
  });
});

describe('outbound auto-advance through the transition service', () => {
  it('advances both columns when a tracking number is first added', async () => {
    Object.assign(harness.db.sales[0], { workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'AWAITING_SHIPMENT' });
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: FEDEX });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_OUT');
    expect(harness.db.sales[0]).toMatchObject({ status: 'SHIPPED_OUT', workflow_status: 'OUTBOUND' });
  });

  it('rejects a first tracking number on a sale status that is already further along', async () => {
    Object.assign(harness.db.sales[0], { status: 'PAID', workflow_status: 'PAID' });
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: FEDEX });
    expect(res.status).toBe(400);
    expect(harness.db.sales[0].status).toBe('PAID');
    expect(harness.db.sales[0].workflow_status).toBe('PAID');
    expect(harness.db.sales[0].tracking_number).toBeUndefined();
  });

  it('advances a brand-new sale created with a tracking number already set', async () => {
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory, platform_id: harness.ids.platform,
      quantity: 1, unit_price: 50, tracking_number: FEDEX,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_OUT');
    expect(res.body).toMatchObject({ workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'OUTBOUND' });
  });

  it('stamps workflow_status_changed_at when a tracking number advances a new sale at creation', async () => {
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory, platform_id: harness.ids.platform,
      quantity: 1, unit_price: 50, tracking_number: FEDEX,
    });
    expect(res.status).toBe(200);
    expect(harness.db.sales.find((s) => s.id === res.body.id)).toMatchObject({ workflow_status: 'OUTBOUND' });
    expect(harness.db.sales.find((s) => s.id === res.body.id).workflow_status_changed_at).toBeInstanceOf(Date);
  });

  it('stamps workflow_status_changed_at when a tracking number advances a sale after the fact', async () => {
    Object.assign(harness.db.sales[0], {
      workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'AWAITING_SHIPMENT',
      status: 'SOLD', tracking_number: null, workflow_status_changed_at: null,
    });
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: FEDEX });
    expect(res.status).toBe(200);
    expect(harness.db.sales[0].workflow_status).toBe('OUTBOUND');
    expect(harness.db.sales[0].workflow_status_changed_at).toBeInstanceOf(Date);
  });

  it('copies the platform\'s workflow preset onto a new sale instead of reading it later', async () => {
    harness.db.platform.find((p) => p.id === harness.ids.platform).workflow_preset = 'CASHOUT';
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory, platform_id: harness.ids.platform, quantity: 1, unit_price: 50,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'SOLD', workflow_type: 'CASHOUT', workflow_status: 'AWAITING_SHIPMENT' });

    // Changing the platform's preset afterwards must not rewrite the sale.
    harness.db.platform.find((p) => p.id === harness.ids.platform).workflow_preset = 'DIRECT_LOCAL';
    expect(harness.db.sales.find((s) => s.id === res.body.id).workflow_type).toBe('CASHOUT');
  });
});

// --- First-time tracking number is gated to the right state -------------------
// Setting a tracking number on a record that has none *is* the
// add_tracking/add_outbound_tracking business action, so the PUT routes reject it
// outside the states that offer that action instead of storing it anyway. Editing,
// replacing and clearing a number the record already has stay allowed in every
// status: correcting tracking after delivery is a legitimate fix.

describe('first-time tracking number is gated to the states that allow it', () => {
  const seedInventory = (overrides) => harness.prisma.inventory.create({
    data: {
      user_id: harness.ids.user, product_name: 'Gated purchase', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, ...overrides,
    },
  });

  it('rejects a first tracking number on an ON_HAND purchase and stores nothing', async () => {
    const created = await seedInventory({ status: 'On Hand', receiving_status: 'ON_HAND' });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been received/);
    const row = harness.db.inventory.find((i) => i.id === created.id);
    expect(row.tracking_number).toBeUndefined();
    expect(row.receiving_status).toBe('ON_HAND');
    expect(row.status).toBe('On Hand');
  });

  it('rejects a first tracking number even when other fields are sent alongside it', async () => {
    const created = await seedInventory({ status: 'On Hand', receiving_status: 'ON_HAND', order_number: 'ORD-1' });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS, order_number: 'ORD-2' });
    expect(res.status).toBe(400);
    // The whole request is refused, so the unrelated edit is not applied either.
    expect(harness.db.inventory.find((i) => i.id === created.id).order_number).toBe('ORD-1');
  });

  it('allows a first tracking number on PURCHASED and PRE_ORDER, and advances them', async () => {
    for (const [legacy, receiving] of [['PURCHASED', 'PURCHASED'], ['Pre Order', 'PRE_ORDER']]) {
      const created = await seedInventory({ status: legacy, receiving_status: receiving });
      const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
      expect(res.status).toBe(200);
      expect(harness.db.inventory.find((i) => i.id === created.id)).toMatchObject({
        status: 'SHIPPED_IN', receiving_status: 'INBOUND', tracking_number: UPS,
      });
    }
  });

  it('allows replacing a tracking number an ON_HAND purchase already has', async () => {
    const created = await seedInventory({ status: 'On Hand', receiving_status: 'ON_HAND', tracking_number: '9400111899223856928499' });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
    expect(res.status).toBe(200);
    const row = harness.db.inventory.find((i) => i.id === created.id);
    expect(row.tracking_number).toBe(UPS);
    // A correction is not a status change.
    expect(row.receiving_status).toBe('ON_HAND');
    expect(row.status).toBe('On Hand');
  });

  it('allows clearing a tracking number in any status', async () => {
    for (const receiving of ['ON_HAND', 'INBOUND']) {
      const created = await seedInventory({ status: 'On Hand', receiving_status: receiving, tracking_number: UPS });
      for (const blank of [null, '']) {
        const res = await put(`/api/inventory/${created.id}`, { tracking_number: blank });
        expect(res.status).toBe(200);
        expect(harness.db.inventory.find((i) => i.id === created.id).tracking_number).toBeNull();
      }
    }
  });

  it('leaves a purchase with no receiving_status at all ungated', async () => {
    // Nothing to judge it against, and its legacy column must keep advancing.
    const created = await seedInventory({ status: 'On Hand' });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: UPS });
    expect(res.status).toBe(200);
    expect(harness.db.inventory.find((i) => i.id === created.id).tracking_number).toBe(UPS);
  });

  it('rejects a first tracking number on a PAID sale and stores nothing', async () => {
    Object.assign(harness.db.sales[0], { status: 'PAID', workflow_status: 'PAID', tracking_number: null });
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: FEDEX });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not awaiting shipment/);
    expect(harness.db.sales[0].tracking_number).toBeNull();
    expect(harness.db.sales[0].workflow_status).toBe('PAID');
  });

  it('rejects a first tracking number on a DIRECT_LOCAL sale, which never ships', async () => {
    Object.assign(harness.db.sales[0], {
      status: 'SOLD', workflow_type: 'DIRECT_LOCAL', workflow_status: 'AWAITING_HANDOFF', tracking_number: null,
    });
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: FEDEX });
    expect(res.status).toBe(400);
    expect(harness.db.sales[0].workflow_status).toBe('AWAITING_HANDOFF');
    expect(harness.db.sales[0].tracking_number).toBeNull();
  });

  it('allows a first tracking number on an AWAITING_SHIPMENT sale, and advances it', async () => {
    Object.assign(harness.db.sales[0], {
      status: 'SOLD', workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'AWAITING_SHIPMENT', tracking_number: null,
    });
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: FEDEX });
    expect(res.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({
      status: 'SHIPPED_OUT', workflow_status: 'OUTBOUND', tracking_number: FEDEX,
    });
  });

  it('allows replacing and clearing a tracking number a PAID sale already has', async () => {
    Object.assign(harness.db.sales[0], { status: 'PAID', workflow_status: 'PAID', tracking_number: '999999999999' });
    const replaced = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: UPS });
    expect(replaced.status).toBe(200);
    expect(harness.db.sales[0].tracking_number).toBe(UPS);
    expect(harness.db.sales[0].workflow_status).toBe('PAID');

    const cleared = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: null });
    expect(cleared.status).toBe(200);
    expect(harness.db.sales[0].tracking_number).toBeNull();
  });

  it('leaves a sale with no workflow_status at all ungated', async () => {
    Object.assign(harness.db.sales[0], { status: 'SOLD', workflow_status: null, tracking_number: null });
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: FEDEX });
    expect(res.status).toBe(200);
    expect(harness.db.sales[0].tracking_number).toBe(FEDEX);
    expect(harness.db.sales[0].status).toBe('SHIPPED_OUT');
  });
});

// --- "Last status updated" at creation ---------------------------------------
// A brand-new record must not start life with a NULL stamp: it has a status from
// the moment it exists, so it has a "status last changed" moment too. Without
// this, every freshly added purchase and sale would show no timestamp at all on
// the Statuses board until its first action.

describe('creation stamps the last-status-updated timestamp', () => {
  const inventoryRow = (id) => harness.db.inventory.find((row) => row.id === id);
  const saleRow = (id) => harness.db.sales.find((row) => row.id === id);

  it('stamps a new purchase alongside the receiving status it is created with', async () => {
    const before = Date.now();
    const res = await post('/api/inventory', {
      product_name: 'Stamped at creation', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body.receiving_status).toBe('PURCHASED');
    const stamp = inventoryRow(res.body.id).receiving_status_changed_at;
    expect(stamp).toBeInstanceOf(Date);
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before);
    // The response carries it too (as JSON, so an ISO string), which is what the
    // board shows without a refetch.
    expect(res.body.receiving_status_changed_at).toBe(stamp.toISOString());
  });

  it('stamps a purchase created with a tracking number from its advanced status', async () => {
    const res = await post('/api/inventory', {
      product_name: 'Created inbound', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 1, tracking_number: UPS,
    });
    expect(res.status).toBe(200);
    expect(res.body.receiving_status).toBe('INBOUND');
    expect(inventoryRow(res.body.id).receiving_status_changed_at).toBeInstanceOf(Date);
  });

  // A legacy status with no unambiguous new-column equivalent leaves
  // receiving_status NULL on purpose, and a NULL status has no "changed at"
  // moment to record -- the board renders no timestamp for it rather than a
  // misleading one.
  it('leaves the stamp NULL when the chosen legacy status maps to no receiving status', async () => {
    const res = await post('/api/inventory', {
      product_name: 'Ambiguous legacy status', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 1, status: 'COMPLETED',
    });
    expect(res.status).toBe(200);
    expect(inventoryRow(res.body.id).receiving_status).toBeUndefined();
    expect(inventoryRow(res.body.id).receiving_status_changed_at).toBeUndefined();
  });

  it('stamps the sale a purchase is created with, from the same moment as the purchase', async () => {
    const res = await post('/api/inventory', {
      product_name: 'Bought and sold at once', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 2, sale_price: 40, qty_sold: 1,
      sale_tab: 'marketplace', marketplace_platform_id: harness.ids.platform,
    });
    expect(res.status).toBe(200);
    const sale = harness.db.sales.find((row) => row.inventory_id === res.body.id);
    expect(sale).toMatchObject({ workflow_status: 'AWAITING_SHIPMENT' });
    expect(sale.workflow_status_changed_at).toBeInstanceOf(Date);
    // One clock for the whole request, so the purchase and its sale agree.
    expect(sale.workflow_status_changed_at.toISOString())
      .toBe(inventoryRow(res.body.id).receiving_status_changed_at.toISOString());
  });

  it('stamps a new sale alongside the workflow status it is created with', async () => {
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory, platform_id: harness.ids.platform, quantity: 1, unit_price: 50,
    });
    expect(res.status).toBe(200);
    expect(res.body.workflow_status).toBe('AWAITING_SHIPMENT');
    const stamp = saleRow(res.body.id).workflow_status_changed_at;
    expect(stamp).toBeInstanceOf(Date);
    expect(res.body.workflow_status_changed_at).toBe(stamp.toISOString());
  });

  it('leaves a new sale\'s stamp NULL when its legacy status maps to no workflow status', async () => {
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory, platform_id: harness.ids.platform,
      quantity: 1, unit_price: 50, status: 'COMPLETED',
    });
    expect(res.status).toBe(200);
    expect(saleRow(res.body.id).workflow_status).toBeNull();
    expect(saleRow(res.body.id).workflow_status_changed_at).toBeUndefined();
  });
});
