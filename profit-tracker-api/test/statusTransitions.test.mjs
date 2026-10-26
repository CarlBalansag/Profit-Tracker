import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const {
  INVENTORY_RECEIVING_STATUSES,
  SALE_WORKFLOW_TYPES,
  SALE_STATUSES_BY_WORKFLOW,
  SALE_EXCEPTION_STATUSES,
  EXCLUDED_FROM_FINANCIALS,
  DISPLAY_LABELS,
  allowedActions,
  applyTransition,
  displayLabel,
  availabilityLabel,
  isExcludedFromFinancials,
} = require('../services/statusTransitions.js');

beforeEach(() => harness.reset());

const names = (record, kind) => allowedActions(record, kind).map((action) => action.action);
const find = (record, kind, action) => allowedActions(record, kind).find((entry) => entry.action === action);
const inventory = (overrides = {}) => ({ id: 'inv', user_id: harness.ids.user, qty_on_hand: 1, is_listed: false, ...overrides });
const sale = (workflow_status, workflow_type = 'STANDARD_MARKETPLACE', overrides = {}) =>
  ({ id: 'sale', inventory_id: 'inv', user_id: harness.ids.user, quantity: 2, workflow_status, workflow_type, ...overrides });

describe('status registry vocabulary', () => {
  it('keeps the receiving path, every workflow path and the exception set canonical', () => {
    expect(INVENTORY_RECEIVING_STATUSES).toEqual(['PRE_ORDER', 'PURCHASED', 'INBOUND', 'ON_HAND']);
    expect(SALE_STATUSES_BY_WORKFLOW.STANDARD_MARKETPLACE).toEqual(['AWAITING_SHIPMENT', 'OUTBOUND', 'WAITING_FOR_PAYMENT', 'PAID']);
    expect(SALE_STATUSES_BY_WORKFLOW.AUTH_MARKETPLACE).toEqual(['AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING', 'WAITING_FOR_PAYMENT', 'PAID']);
    expect(SALE_STATUSES_BY_WORKFLOW.CASHOUT).toEqual(['AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_PROVIDER', 'WAITING_FOR_SCAN_IN', 'SCANNED_IN', 'ACCEPTED', 'WAITING_FOR_PAYMENT', 'PAID']);
    expect(SALE_STATUSES_BY_WORKFLOW.DIRECT_LOCAL).toEqual(['AWAITING_HANDOFF', 'HANDED_OVER', 'WAITING_FOR_PAYMENT', 'PAID']);
    expect(SALE_EXCEPTION_STATUSES).toEqual(['CANCELLED', 'RETURN_IN_PROGRESS', 'RETURNED', 'DISPUTED', 'AUTHENTICATION_FAILED']);
    // validation/schemas.js validates an incoming workflow_type against
    // SALE_WORKFLOW_TYPES, so a workflow with a path but no entry in that list
    // would be rejected at the request boundary and unreachable from the UI.
    expect(SALE_WORKFLOW_TYPES).toEqual(Object.keys(SALE_STATUSES_BY_WORKFLOW));
    // Every workflow ends on PAID, and every status in every list has a label.
    for (const path of Object.values(SALE_STATUSES_BY_WORKFLOW)) expect(path.at(-1)).toBe('PAID');
    for (const status of [...Object.values(SALE_STATUSES_BY_WORKFLOW).flat(), ...SALE_EXCEPTION_STATUSES, ...INVENTORY_RECEIVING_STATUSES]) {
      expect(DISPLAY_LABELS[status], status).toBeTruthy();
    }
  });

  it('matches decimalFinance.isRealizedSale exactly so checkpoint 2 can swap in this export', () => {
    expect([...EXCLUDED_FROM_FINANCIALS].sort()).toEqual(['CANCELLED', 'DISPUTED', 'RETURNED']);
    for (const status of ['CANCELLED', 'RETURNED', 'DISPUTED', 'cancelled']) expect(isExcludedFromFinancials(status)).toBe(true);
    for (const status of ['PAID', 'OUTBOUND', 'AWAITING_SHIPMENT', '', null, 'RETURN_IN_PROGRESS']) {
      expect(isExcludedFromFinancials(status), String(status)).toBe(false);
    }
  });

  it('uses the plan wording for the renamed sale statuses and derives availability', () => {
    expect(displayLabel('AWAITING_SHIPMENT')).toBe('Sold — Waiting to Ship');
    expect(displayLabel('OUTBOUND')).toBe('Outbound');
    expect(displayLabel('ON_HAND')).toBe('On Hand');
    expect(displayLabel('UNKNOWN_THING')).toBe('UNKNOWN_THING');
    expect(availabilityLabel({ qty_on_hand: 3 })).toBe('Available');
    expect(availabilityLabel({ qty_on_hand: 0 })).toBe('Sold Out');
  });
});

describe('allowedActions for inventory receiving states', () => {
  it('offers the plan\'s primary actions for each receiving status', () => {
    expect(names(inventory({ receiving_status: 'PRE_ORDER' }), 'inventory')).toEqual(['mark_purchased', 'add_tracking', 'cancel', 'correct_status']);
    expect(names(inventory({ receiving_status: 'PURCHASED' }), 'inventory')).toEqual(['add_tracking', 'mark_on_hand', 'cancel', 'correct_status']);
    expect(names(inventory({ receiving_status: 'INBOUND' }), 'inventory')).toEqual(['check_tracking', 'mark_on_hand', 'cancel', 'correct_status']);
    // A purchase that already arrived cannot be cancelled, only corrected.
    expect(names(inventory({ receiving_status: 'ON_HAND' }), 'inventory')).toEqual(['list_item', 'record_sale', 'restore_inventory', 'correct_status']);
  });

  it('swaps List Item for Unlist once the purchase is listed', () => {
    expect(names(inventory({ receiving_status: 'ON_HAND', is_listed: true }), 'inventory'))
      .toEqual(['record_sale', 'unlist', 'restore_inventory', 'correct_status']);
  });

  it('hides Record Sale when nothing is left on hand but keeps the purchase ON_HAND', () => {
    const soldOut = inventory({ receiving_status: 'ON_HAND', qty_on_hand: 0 });
    expect(names(soldOut, 'inventory')).not.toContain('record_sale');
    expect(names(soldOut, 'inventory')).toContain('list_item');
  });

  // A row the backfill could not resolve used to get no actions at all, which
  // left it permanently stuck on the Statuses board. It now gets exactly one:
  // the user setting the receiving step by hand. Still no guess -- just a way in.
  it('offers a legacy row the backfill has not reached a way to set its status', () => {
    for (const current of [null, undefined, '', 'SHIPPED_IN']) {
      const descriptors = allowedActions(inventory({ receiving_status: current }), 'inventory');
      expect(descriptors, String(current)).toEqual([
        { action: 'correct_status', label: 'Set Receiving Status', requiresForm: true, destructive: false, secondary: false, initial: true },
      ]);
      // Primary, not a "More" menu entry: it is the only action there is.
      expect(descriptors[0].secondary, String(current)).toBe(false);
      expect(descriptors.filter((entry) => !entry.secondary)).toHaveLength(1);
    }
  });

  it('still offers nothing for an unknown record kind', () => {
    expect(allowedActions(inventory({ receiving_status: 'ON_HAND' }), 'nonsense')).toEqual([]);
    expect(allowedActions(inventory({ receiving_status: null }), 'nonsense')).toEqual([]);
  });
});

describe('allowedActions for every sale workflow', () => {
  it.each(['STANDARD_MARKETPLACE', 'AUTH_MARKETPLACE', 'CASHOUT'])('%s starts on Add Outbound Tracking and ends on Mark Completed', (workflow) => {
    expect(names(sale('AWAITING_SHIPMENT', workflow), 'sale')[0]).toBe('add_outbound_tracking');
    expect(names(sale('OUTBOUND', workflow), 'sale')[0]).toBe('check_tracking');
    expect(names(sale('WAITING_FOR_PAYMENT', workflow), 'sale')[0]).toBe('mark_paid');
    expect(allowedActions(sale('PAID', workflow), 'sale').filter((entry) => !entry.secondary)).toEqual([
      expect.objectContaining({ action: 'mark_completed', secondary: false }),
    ]);
    // Already marked complete: nothing left to accelerate.
    expect(allowedActions(sale('PAID', workflow, { completed_at: new Date() }), 'sale').filter((entry) => !entry.secondary))
      .toEqual([]);
  });

  it('DIRECT_LOCAL uses handoff wording and can take payment before the handoff', () => {
    expect(names(sale('AWAITING_HANDOFF', 'DIRECT_LOCAL'), 'sale').slice(0, 2)).toEqual(['mark_handed_over', 'mark_paid']);
    expect(names(sale('HANDED_OVER', 'DIRECT_LOCAL'), 'sale')[0]).toBe('mark_paid');
    expect(names(sale('WAITING_FOR_PAYMENT', 'DIRECT_LOCAL'), 'sale')[0]).toBe('mark_paid');
    expect(allowedActions(sale('PAID', 'DIRECT_LOCAL'), 'sale').filter((entry) => !entry.secondary)).toEqual([
      expect.objectContaining({ action: 'mark_completed', secondary: false }),
    ]);
  });

  it('AUTH_MARKETPLACE offers Mark Passed and Mark Failed while authenticating', () => {
    const actions = names(sale('AUTHENTICATING', 'AUTH_MARKETPLACE'), 'sale');
    expect(actions.slice(0, 2)).toEqual(['mark_authentication_passed', 'mark_authentication_failed']);
    expect(find(sale('AUTHENTICATING', 'AUTH_MARKETPLACE'), 'sale', 'mark_authentication_failed').destructive).toBe(true);
    expect(find(sale('AUTHENTICATING', 'AUTH_MARKETPLACE'), 'sale', 'mark_authentication_passed').destructive).toBe(false);
    expect(names(sale('DELIVERED_TO_AUTHENTICATOR', 'AUTH_MARKETPLACE'), 'sale').slice(0, 2)).toEqual(['check_tracking', 'mark_authenticating']);
  });

  it('CASHOUT offers scan-in then acceptance', () => {
    expect(names(sale('DELIVERED_TO_PROVIDER', 'CASHOUT'), 'sale').slice(0, 2)).toEqual(['check_tracking', 'mark_waiting_for_scan_in']);
    expect(names(sale('WAITING_FOR_SCAN_IN', 'CASHOUT'), 'sale')[0]).toBe('mark_scanned_in');
    expect(names(sale('SCANNED_IN', 'CASHOUT'), 'sale')[0]).toBe('mark_accepted');
    expect(names(sale('ACCEPTED', 'CASHOUT'), 'sale')[0]).toBe('mark_waiting_for_payment');
  });

  it('routes an authentication failure through a return instead of restoring inventory', () => {
    expect(names(sale('AUTHENTICATION_FAILED', 'AUTH_MARKETPLACE'), 'sale')).toEqual(['report_return', 'correct_status']);
    expect(names(sale('RETURN_IN_PROGRESS', 'AUTH_MARKETPLACE'), 'sale')).toEqual(['mark_returned', 'correct_status']);
    expect(find(sale('RETURN_IN_PROGRESS'), 'sale', 'mark_returned')).toMatchObject({ requiresForm: true, destructive: true });
  });

  it('offers only a correction for terminal exception states', () => {
    for (const status of ['RETURNED', 'DISPUTED', 'CANCELLED']) {
      expect(names(sale(status), 'sale'), status).toEqual(['correct_status']);
    }
  });

  it('offers an unmigrated or ambiguous sale one primary action to set its status', () => {
    for (const current of [null, undefined, '', 'PURCHASED', 'COMPLETED']) {
      // workflow_type is deliberately absent too: these rows usually have neither.
      const descriptors = allowedActions({ id: 'sale', quantity: 1, workflow_status: current }, 'sale');
      expect(descriptors, String(current)).toEqual([
        { action: 'correct_status', label: 'Set Sale Status', requiresForm: true, destructive: false, secondary: false, initial: true },
      ]);
      expect(descriptors[0].secondary, String(current)).toBe(false);
    }
  });
});

describe('action descriptor policy', () => {
  const everyState = [
    ...Object.entries(SALE_STATUSES_BY_WORKFLOW).flatMap(([workflow, path]) => path.map((status) => [sale(status, workflow), 'sale'])),
    ...SALE_EXCEPTION_STATUSES.map((status) => [sale(status), 'sale']),
    ...INVENTORY_RECEIVING_STATUSES.flatMap((status) => [
      [inventory({ receiving_status: status }), 'inventory'],
      [inventory({ receiving_status: status, is_listed: true, qty_on_hand: 0 }), 'inventory'],
    ]),
  ];

  it('never offers a one-click Mark Paid anywhere in any workflow', () => {
    let seen = 0;
    for (const [record, kind] of everyState) {
      for (const descriptor of allowedActions(record, kind)) {
        if (descriptor.action !== 'mark_paid') continue;
        seen += 1;
        expect(descriptor.requiresForm, JSON.stringify(record)).toBe(true);
        expect(descriptor.destructive).toBe(false);
        expect(descriptor.label).toBe('Mark Paid');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('flags every irreversible action as destructive and every descriptor with the full shape', () => {
    const mustBeDestructive = new Set(['void_sale', 'reopen_sale', 'report_return', 'report_dispute', 'mark_returned', 'mark_authentication_failed', 'restore_inventory', 'cancel']);
    let destructiveSeen = 0;
    for (const [record, kind] of everyState) {
      for (const descriptor of allowedActions(record, kind)) {
        expect(Object.keys(descriptor).sort()).toEqual(['action', 'destructive', 'label', 'requiresForm', 'secondary']);
        expect(typeof descriptor.label).toBe('string');
        if (mustBeDestructive.has(descriptor.action)) {
          expect(descriptor.destructive, `${descriptor.action} on ${JSON.stringify(record)}`).toBe(true);
          destructiveSeen += 1;
        }
      }
    }
    expect(destructiveSeen).toBeGreaterThan(0);
  });

  it('treats cancelling a shipped sale as destructive but a not-yet-shipped one as routine', () => {
    expect(find(sale('AWAITING_SHIPMENT'), 'sale', 'cancel_sale').destructive).toBe(false);
    expect(find(sale('OUTBOUND'), 'sale', 'cancel_sale').destructive).toBe(true);
    expect(find(sale('PAID'), 'sale', 'reopen_sale')).toMatchObject({ destructive: true, secondary: true });
  });
});

// --- applyTransition -------------------------------------------------------
// These run the real transition against the in-memory Prisma double in
// qa/harness.cjs, including its snapshot-rollback $transaction, so the
// optimistic-concurrency guards are exercised the same way the route tests
// (test/atomicSales.test.mjs) exercise the routes' own guards.

const run = (kind, record, action, payload) =>
  harness.prisma.$transaction((tx) => applyTransition(tx, kind, record, action, payload));

const seedSale = (overrides = {}) => {
  Object.assign(harness.db.inventory[0], { receiving_status: 'ON_HAND', is_listed: false, qty_on_hand: 3 });
  Object.assign(harness.db.sales[0], {
    quantity: 2, workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT',
    workflow_status_changed_at: null,
    paid_at: null, cancelled_at: null, voided_at: null, delivered_at: null, returned_at: null,
    return_requested_at: null, disputed_at: null, ...overrides,
  });
  return { ...harness.db.sales[0], user_id: harness.ids.user };
};

describe('applyTransition — inventory', () => {
  const seedInventory = (receiving_status, overrides = {}) => {
    Object.assign(harness.db.inventory[0], { receiving_status, is_listed: false, ...overrides });
    return { ...harness.db.inventory[0] };
  };

  it('advances the receiving path and records received_at on arrival', async () => {
    expect((await run('inventory', seedInventory('PRE_ORDER'), 'mark_purchased')).to).toBe('PURCHASED');
    expect(harness.db.inventory[0].receiving_status).toBe('PURCHASED');

    const withTracking = await run('inventory', seedInventory('PURCHASED'), 'add_tracking', { tracking_number: '1Z999AA10123456784' });
    expect(withTracking.to).toBe('INBOUND');
    expect(harness.db.inventory[0]).toMatchObject({ receiving_status: 'INBOUND', tracking_number: '1Z999AA10123456784' });

    const received = new Date('2026-09-20T00:00:00Z');
    await run('inventory', seedInventory('INBOUND'), 'mark_on_hand', { received_at: received });
    expect(harness.db.inventory[0]).toMatchObject({ receiving_status: 'ON_HAND' });
    expect(harness.db.inventory[0].received_at.toISOString()).toBe(received.toISOString());
  });

  it('is a proven superset of the retired statusHierarchy inbound auto-advance', async () => {
    // statusHierarchy.autoShippedStatus('inbound') advanced exactly
    // {'Pre Order','PURCHASED'} -> SHIPPED_IN (now INBOUND) and nothing else.
    for (const from of ['PRE_ORDER', 'PURCHASED']) {
      await run('inventory', seedInventory(from), 'add_tracking', { tracking_number: 'T1' });
      expect(harness.db.inventory[0].receiving_status, from).toBe('INBOUND');
    }
    for (const from of ['INBOUND', 'ON_HAND']) {
      await expect(run('inventory', seedInventory(from), 'add_tracking', { tracking_number: 'T1' })).rejects.toThrow(/not available/);
      expect(harness.db.inventory[0].receiving_status, from).toBe(from);
    }
  });

  it('toggles the listing attribute without touching the receiving status or quantity', async () => {
    await run('inventory', seedInventory('ON_HAND'), 'list_item');
    expect(harness.db.inventory[0]).toMatchObject({ is_listed: true, receiving_status: 'ON_HAND', qty_on_hand: 3 });
    await run('inventory', { ...harness.db.inventory[0] }, 'unlist');
    expect(harness.db.inventory[0]).toMatchObject({ is_listed: false, receiving_status: 'ON_HAND', qty_on_hand: 3 });
  });

  it('rejects an incomplete or out-of-vocabulary payload without writing', async () => {
    await expect(run('inventory', seedInventory('PURCHASED'), 'add_tracking', { tracking_number: '  ' })).rejects.toThrow(/Tracking number is required/);
    await expect(run('inventory', seedInventory('ON_HAND'), 'correct_status', { receiving_status: 'SHIPPED_IN' })).rejects.toThrow(/valid receiving status/);
    expect(harness.db.inventory[0]).toMatchObject({ receiving_status: 'ON_HAND', tracking_number: '9400111899223856928499' });
    const corrected = await run('inventory', seedInventory('ON_HAND'), 'correct_status', { receiving_status: 'INBOUND', correction_note: 'Marked received too early' });
    expect(corrected.to).toBe('INBOUND');
    expect(harness.db.inventory[0]).toMatchObject({ receiving_status: 'INBOUND', correction_note: 'Marked received too early' });
  });

  it('corrects quantity on hand within the purchased quantity, guarded on the quantity it read', async () => {
    const record = seedInventory('ON_HAND', { qty_on_hand: 3, qty_purchased: 5 });
    await expect(run('inventory', record, 'restore_inventory', { qty_on_hand: 6 })).rejects.toThrow(/between 0 and the quantity purchased/);
    await expect(run('inventory', record, 'restore_inventory', { qty_on_hand: -1 })).rejects.toThrow(/between 0 and the quantity purchased/);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);

    await run('inventory', record, 'restore_inventory', { qty_on_hand: 5, correction_note: 'Miscounted' });
    expect(harness.db.inventory[0]).toMatchObject({ qty_on_hand: 5, correction_note: 'Miscounted', receiving_status: 'ON_HAND' });

    // The stale snapshot still says 3 on hand, so replaying it must not win.
    await expect(run('inventory', record, 'restore_inventory', { qty_on_hand: 4 })).rejects.toThrow(/changed while saving/);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  it('refuses a transition the record\'s current status does not allow, and an unowned record', async () => {
    await expect(run('inventory', seedInventory('ON_HAND'), 'mark_purchased')).rejects.toThrow(/not available/);
    await expect(run('inventory', { ...seedInventory('PRE_ORDER'), user_id: null }, 'mark_purchased')).rejects.toThrow(/owner is required/);
    await expect(run('inventory', { ...seedInventory('PRE_ORDER'), user_id: harness.ids.other }, 'mark_purchased')).rejects.toThrow(/changed while saving/);
    expect(harness.db.inventory[0].receiving_status).toBe('PRE_ORDER');
  });

  it('rejects a stale receiving status rather than re-applying a transition', async () => {
    const stale = seedInventory('PURCHASED');
    harness.db.inventory[0].receiving_status = 'ON_HAND'; // a concurrent request won
    await expect(run('inventory', stale, 'mark_on_hand')).rejects.toThrow(/changed while saving/);
    expect(harness.db.inventory[0].receiving_status).toBe('ON_HAND');
  });
});

describe('applyTransition — sale', () => {
  it('records a payment only through the form fields and lands on PAID', async () => {
    const record = seedSale();
    const result = await run('sale', record, 'mark_paid', { paid_at: '2026-09-30T00:00:00Z', paid_amount: '288.00', paid_reference: 'PP-991' });
    expect(result.to).toBe('PAID');
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'PAID', paid_amount: '288.00', paid_reference: 'PP-991' });
    // payout_date is a user reminder and must stay untouched by a payment.
    expect(harness.db.sales[0].payout_date).toBeNull();
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });

  it('is a proven superset of the retired statusHierarchy outbound auto-advance', async () => {
    // autoShippedStatus('outbound') advanced exactly SOLD (now
    // AWAITING_SHIPMENT) -> SHIPPED_OUT (now OUTBOUND) and nothing else.
    await run('sale', seedSale({ workflow_status: 'AWAITING_SHIPMENT' }), 'add_outbound_tracking', { tracking_number: '999999999999' });
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'OUTBOUND', tracking_number: '999999999999' });
    for (const from of ['OUTBOUND', 'WAITING_FOR_PAYMENT', 'PAID']) {
      await expect(run('sale', seedSale({ workflow_status: from }), 'add_outbound_tracking', { tracking_number: 'X' })).rejects.toThrow(/not available/);
      expect(harness.db.sales[0].workflow_status, from).toBe(from);
    }
  });

  it('advances a carrier delivery along the sale\'s own stored workflow and never backward', async () => {
    const expected = { STANDARD_MARKETPLACE: 'WAITING_FOR_PAYMENT', AUTH_MARKETPLACE: 'DELIVERED_TO_AUTHENTICATOR', CASHOUT: 'DELIVERED_TO_PROVIDER' };
    for (const [workflow, target] of Object.entries(expected)) {
      const record = seedSale({ workflow_status: 'OUTBOUND', workflow_type: workflow });
      expect((await run('sale', record, 'mark_delivered')).to, workflow).toBe(target);
      expect(harness.db.sales[0].delivered_at).toBeInstanceOf(Date);
      // A repeated carrier check for the same package must not advance again.
      await expect(run('sale', { ...harness.db.sales[0], user_id: harness.ids.user }, 'mark_delivered')).rejects.toThrow(/not available/);
      expect(harness.db.sales[0].workflow_status).toBe(target);
    }
  });

  it('completes a local sale on handoff when payment already arrived', async () => {
    const prepaid = seedSale({ workflow_status: 'AWAITING_HANDOFF', workflow_type: 'DIRECT_LOCAL' });
    // Payment before handoff records paid_at but keeps the sale actionable.
    expect((await run('sale', prepaid, 'mark_paid', { paid_amount: '120.00' })).to).toBe('AWAITING_HANDOFF');
    expect(harness.db.sales[0].paid_at).toBeInstanceOf(Date);
    const handed = await run('sale', { ...harness.db.sales[0], user_id: harness.ids.user }, 'mark_handed_over');
    expect(handed.to).toBe('PAID');

    // Without a payment, the handoff only moves to HANDED_OVER.
    const unpaid = seedSale({ workflow_status: 'AWAITING_HANDOFF', workflow_type: 'DIRECT_LOCAL' });
    expect((await run('sale', unpaid, 'mark_handed_over')).to).toBe('HANDED_OVER');
  });

  it('keeps a reopened payment on the record', async () => {
    const paid = seedSale({ workflow_status: 'PAID', paid_at: new Date('2026-09-10T00:00:00Z'), paid_amount: '288.00' });
    expect((await run('sale', paid, 'reopen_sale')).to).toBe('WAITING_FOR_PAYMENT');
    expect(harness.db.sales[0].paid_at).toBeInstanceOf(Date);
    expect(harness.db.sales[0].paid_amount).toBe('288.00');
  });

  it('marks a paid sale complete without touching workflow_status or paid_at', async () => {
    const paid = seedSale({ workflow_status: 'PAID', paid_at: new Date('2026-09-10T00:00:00Z'), paid_amount: '288.00' });
    const result = await run('sale', paid, 'mark_completed');
    expect(result.to).toBe('PAID');
    expect(harness.db.sales[0].completed_at).toBeInstanceOf(Date);
    expect(harness.db.sales[0].paid_at).toEqual(new Date('2026-09-10T00:00:00Z'));
    // Already-completed is no longer an available action -- nothing left to
    // accelerate, and the registry gate rejects a repeat attempt.
    await expect(run('sale', { ...harness.db.sales[0], user_id: harness.ids.user }, 'mark_completed'))
      .rejects.toThrow(/not available/);
  });

  it('does not restore inventory when a return is only requested, and does once it arrives', async () => {
    const record = seedSale({ workflow_status: 'PAID' });
    expect((await run('sale', record, 'report_return')).to).toBe('RETURN_IN_PROGRESS');
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    expect(harness.db.sales[0].return_requested_at).toBeInstanceOf(Date);

    const received = await run('sale', { ...harness.db.sales[0], user_id: harness.ids.user }, 'mark_returned', {});
    expect(received).toMatchObject({ to: 'RETURNED', restored: 2 });
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  it('preserves the inventory position for a dispute', async () => {
    expect((await run('sale', seedSale({ workflow_status: 'OUTBOUND' }), 'report_dispute')).to).toBe('DISPUTED');
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    expect(harness.db.sales[0].disputed_at).toBeInstanceOf(Date);
  });

  it('restores the sold units atomically on a void and distinguishes it from a cancellation', async () => {
    const voided = await run('sale', seedSale(), 'void_sale');
    expect(voided).toMatchObject({ to: 'CANCELLED', restored: 2 });
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
    expect(harness.db.sales[0].voided_at).toBeInstanceOf(Date);
    expect(harness.db.sales[0].cancelled_at).toBeNull();
    // Voided money leaves financial totals via the shared excluded-status set.
    expect(isExcludedFromFinancials(harness.db.sales[0].workflow_status)).toBe(true);

    const cancelled = await run('sale', seedSale(), 'cancel_sale');
    expect(cancelled).toMatchObject({ to: 'CANCELLED', restored: 2 });
    expect(harness.db.sales[0].cancelled_at).toBeInstanceOf(Date);
    expect(harness.db.sales[0].voided_at).toBeNull();
  });

  it('refuses a stale void rather than restoring the same units twice', async () => {
    const stale = seedSale();
    // A concurrent request already voided this sale and restored its units.
    await run('sale', { ...stale }, 'void_sale');
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);

    // The second request still holds the pre-void snapshot. Its status guard no
    // longer matches, so nothing is applied and no units are restored again.
    await expect(run('sale', stale, 'void_sale')).rejects.toThrow(/Sale changed while saving/);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
    expect(harness.db.sales[0].workflow_status).toBe('CANCELLED');
  });

  it('refuses a void whose quantity changed under it, leaving stock and sale intact', async () => {
    const stale = seedSale();
    harness.db.sales[0].quantity = 3; // a concurrent quantity edit won
    harness.db.inventory[0].qty_on_hand = 2;
    await expect(run('sale', stale, 'void_sale')).rejects.toThrow(/Sale changed while saving/);
    expect(harness.db.inventory[0].qty_on_hand).toBe(2);
    expect(harness.db.sales[0]).toMatchObject({ quantity: 3, workflow_status: 'WAITING_FOR_PAYMENT', voided_at: null });
    // Re-reading the row makes the same void succeed exactly once.
    const retried = await run('sale', { ...harness.db.sales[0], user_id: harness.ids.user }, 'void_sale');
    expect(retried.restored).toBe(3);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  it('refuses a quantity-restoring transition on another user\'s inventory', async () => {
    const record = seedSale();
    await expect(run('sale', { ...record, user_id: harness.ids.other }, 'void_sale')).rejects.toThrow(/Inventory not found or access denied/);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    expect(harness.db.sales[0].workflow_status).toBe('WAITING_FOR_PAYMENT');
  });

  it('validates a corrected workflow step against the sale\'s own workflow', async () => {
    const record = seedSale({ workflow_status: 'CANCELLED' });
    await expect(run('sale', record, 'correct_status', { workflow_status: 'SCANNED_IN' })).rejects.toThrow(/valid workflow status/);
    expect((await run('sale', record, 'correct_status', { workflow_status: 'WAITING_FOR_PAYMENT' })).to).toBe('WAITING_FOR_PAYMENT');
    const cashout = seedSale({ workflow_status: 'CANCELLED', workflow_type: 'CASHOUT' });
    expect((await run('sale', cashout, 'correct_status', { workflow_status: 'SCANNED_IN' })).to).toBe('SCANNED_IN');
  });

  // --- correct_status on a sale whose workflow is unknown ---------------------
  describe('correct_status with an explicit workflow type', () => {
    it('sets the workflow type and the status together in one update', async () => {
      const record = seedSale({ workflow_type: null, workflow_status: null });
      const result = await run('sale', record, 'correct_status', { workflow_type: 'CASHOUT', workflow_status: 'SCANNED_IN' });
      expect(result.to).toBe('SCANNED_IN');
      expect(result.data).toMatchObject({ workflow_type: 'CASHOUT', workflow_status: 'SCANNED_IN' });
      expect(harness.db.sales[0]).toMatchObject({ workflow_type: 'CASHOUT', workflow_status: 'SCANNED_IN' });
      // Both land or neither does, so the row can never claim a status its own
      // workflow does not contain.
      expect(SALE_STATUSES_BY_WORKFLOW[harness.db.sales[0].workflow_type]).toContain(harness.db.sales[0].workflow_status);
    });

    it('accepts an exception status under any chosen workflow, and writes the legacy column with it', async () => {
      const record = seedSale({ workflow_type: null, workflow_status: null, status: 'PURCHASED' });
      expect((await run('sale', record, 'correct_status', { workflow_type: 'DIRECT_LOCAL', workflow_status: 'CANCELLED' })).to).toBe('CANCELLED');
      expect(harness.db.sales[0]).toMatchObject({ workflow_type: 'DIRECT_LOCAL', workflow_status: 'CANCELLED', status: 'CANCELLED' });
    });

    it('rejects a workflow type outside the vocabulary rather than falling back to the default', async () => {
      const record = seedSale({ workflow_type: null, workflow_status: null });
      for (const bad of ['NOT_A_WORKFLOW', 'standard_marketplace', 'CASHOUT ']) {
        await expect(run('sale', record, 'correct_status', { workflow_type: bad, workflow_status: 'PAID' }), bad)
          .rejects.toThrow(/valid sale workflow/);
      }
      expect(harness.db.sales[0]).toMatchObject({ workflow_type: null, workflow_status: null });
    });

    it('rejects a status that the chosen workflow does not contain', async () => {
      const record = seedSale({ workflow_type: null, workflow_status: null });
      // SCANNED_IN is CASHOUT-only; AWAITING_HANDOFF is DIRECT_LOCAL-only.
      await expect(run('sale', record, 'correct_status', { workflow_type: 'DIRECT_LOCAL', workflow_status: 'SCANNED_IN' }))
        .rejects.toThrow(/valid workflow status/);
      await expect(run('sale', record, 'correct_status', { workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'AWAITING_HANDOFF' }))
        .rejects.toThrow(/valid workflow status/);
      expect(harness.db.sales[0]).toMatchObject({ workflow_type: null, workflow_status: null });
    });

    // Backward compatibility: every pre-existing caller sends workflow_status
    // alone, and must keep behaving exactly as it did -- including leaving
    // workflow_type out of the update entirely rather than writing the fallback.
    it('behaves identically to before when no workflow type is sent', async () => {
      const known = seedSale({ workflow_type: 'CASHOUT', workflow_status: 'CANCELLED' });
      const result = await run('sale', known, 'correct_status', { workflow_status: 'SCANNED_IN' });
      expect(result.data).toEqual({ workflow_status: 'SCANNED_IN', workflow_status_changed_at: expect.any(Date) });
      expect(Object.keys(result.data)).not.toContain('workflow_type');
      expect(harness.db.sales[0]).toMatchObject({ workflow_type: 'CASHOUT', workflow_status: 'SCANNED_IN' });

      // An empty or null workflow_type is "not supplied", not "invalid".
      for (const absent of [undefined, null, '']) {
        const row = seedSale({ workflow_type: 'CASHOUT', workflow_status: 'CANCELLED' });
        const res = await run('sale', row, 'correct_status', { workflow_type: absent, workflow_status: 'SCANNED_IN' });
        expect(res.data, String(absent)).toEqual({ workflow_status: 'SCANNED_IN', workflow_status_changed_at: expect.any(Date) });
        expect(harness.db.sales[0].workflow_type).toBe('CASHOUT');
      }

      // With no stored workflow_type either, the default path still decides which
      // statuses are valid, exactly as it did before this change.
      const unknown = seedSale({ workflow_type: null, workflow_status: null });
      await expect(run('sale', unknown, 'correct_status', { workflow_status: 'SCANNED_IN' })).rejects.toThrow(/valid workflow status/);
      expect((await run('sale', unknown, 'correct_status', { workflow_status: 'PAID' })).to).toBe('PAID');
      expect(harness.db.sales[0].workflow_type).toBeNull();
    });
  });

  it('rejects an unknown kind, a missing record, and a read-only action', async () => {
    await expect(run('expense', seedSale(), 'mark_paid')).rejects.toThrow(/Unknown record kind/);
    await expect(run('sale', {}, 'mark_paid')).rejects.toThrow(/stored record is required/);
    await expect(run('sale', seedSale({ workflow_status: 'OUTBOUND' }), 'check_tracking')).rejects.toThrow(/not a stored state transition/);
    await expect(run('sale', seedSale(), 'teleport')).rejects.toThrow(/not available/);
  });
});

// --- "Last status updated" --------------------------------------------------
// receiving_status_changed_at / workflow_status_changed_at answer "when did this
// card last move?", which is what the Statuses board shows on every card. The
// rule is deliberately narrow: a transition stamps it only when its own `data`
// writes the status field, from the same `now` the other milestones use. A
// transition that corrects some other field is not a status change.

describe('applyTransition — last status change timestamp', () => {
  const NOW = '2026-10-02T15:30:00.000Z';
  const EARLIER = new Date('2026-09-01T08:00:00.000Z');

  const seedInventory = (receiving_status, overrides = {}) => {
    Object.assign(harness.db.inventory[0], {
      receiving_status, is_listed: false, qty_on_hand: 3, qty_purchased: 5,
      receiving_status_changed_at: null, cancelled_at: null, ...overrides,
    });
    return { ...harness.db.inventory[0] };
  };

  it('stamps receiving_status_changed_at with the transition clock on every receiving status change', async () => {
    const cases = [
      ['PRE_ORDER', 'mark_purchased', {}, 'PURCHASED'],
      ['PURCHASED', 'add_tracking', { tracking_number: 'T1' }, 'INBOUND'],
      ['INBOUND', 'mark_on_hand', {}, 'ON_HAND'],
      ['INBOUND', 'mark_delivered', {}, 'ON_HAND'],
      ['ON_HAND', 'correct_status', { receiving_status: 'INBOUND' }, 'INBOUND'],
    ];
    for (const [from, action, payload, to] of cases) {
      const result = await run('inventory', seedInventory(from), action, { ...payload, now: NOW });
      expect(result.to, action).toBe(to);
      // One clock for the whole transition: the stamp is the same instant as the
      // other milestone the transition writes, not a second `new Date()`.
      expect(result.data.receiving_status_changed_at.toISOString(), action).toBe(NOW);
      expect(harness.db.inventory[0].receiving_status_changed_at.toISOString(), action).toBe(NOW);
      if (action === 'mark_on_hand' || action === 'mark_delivered') {
        expect(harness.db.inventory[0].received_at.toISOString(), action).toBe(NOW);
      }
    }
  });

  // The whole point of keying on the status field rather than "any write":
  // adjusting quantity on hand is a correction, not a status change, so the
  // board must keep showing when the status itself last moved.
  it('never touches receiving_status_changed_at for a transition that leaves the status alone', async () => {
    const unchanged = [
      ['ON_HAND', 'restore_inventory', { qty_on_hand: 4 }],
      ['ON_HAND', 'list_item', {}],
      ['PURCHASED', 'cancel', {}],
    ];
    for (const [from, action, payload] of unchanged) {
      const record = seedInventory(from, { receiving_status_changed_at: EARLIER });
      const result = await run('inventory', record, action, { ...payload, now: NOW });
      expect(result.data.receiving_status_changed_at, action).toBeUndefined();
      expect(harness.db.inventory[0].receiving_status_changed_at.toISOString(), action).toBe(EARLIER.toISOString());
      expect(harness.db.inventory[0].receiving_status, action).toBe(from);
    }
    // ...and the corrections themselves still landed.
    const listed = seedInventory('ON_HAND', { is_listed: true, receiving_status_changed_at: EARLIER });
    await run('inventory', listed, 'unlist', { now: NOW });
    expect(harness.db.inventory[0]).toMatchObject({ is_listed: false, receiving_status: 'ON_HAND' });
    expect(harness.db.inventory[0].receiving_status_changed_at.toISOString()).toBe(EARLIER.toISOString());
  });

  // A row the backfill never reached has no stamp at all; it gets one the first
  // time a status is actually set on it, and nothing is backfilled before that.
  it('gives a never-stamped legacy row its first stamp when a status is finally set', async () => {
    const legacy = seedInventory(null);
    expect(harness.db.inventory[0].receiving_status_changed_at).toBeNull();
    await run('inventory', legacy, 'correct_status', { receiving_status: 'PURCHASED', now: NOW });
    expect(harness.db.inventory[0]).toMatchObject({ receiving_status: 'PURCHASED' });
    expect(harness.db.inventory[0].receiving_status_changed_at.toISOString()).toBe(NOW);
  });

  it('stamps workflow_status_changed_at with the transition clock on every sale status change', async () => {
    const cases = [
      [{ workflow_status: 'AWAITING_SHIPMENT' }, 'add_outbound_tracking', { tracking_number: 'T2' }, 'OUTBOUND'],
      [{ workflow_status: 'OUTBOUND' }, 'mark_delivered', {}, 'WAITING_FOR_PAYMENT'],
      [{}, 'mark_paid', { paid_at: NOW, paid_amount: '288.00' }, 'PAID'],
      [{}, 'void_sale', {}, 'CANCELLED'],
      [{}, 'cancel_sale', {}, 'CANCELLED'],
      [{ workflow_status: 'PAID' }, 'report_return', {}, 'RETURN_IN_PROGRESS'],
      [{ workflow_status: 'CANCELLED' }, 'correct_status', { workflow_status: 'WAITING_FOR_PAYMENT' }, 'WAITING_FOR_PAYMENT'],
    ];
    for (const [seed, action, payload, to] of cases) {
      const result = await run('sale', seedSale(seed), action, { ...payload, now: NOW });
      expect(result.to, action).toBe(to);
      expect(result.data.workflow_status_changed_at.toISOString(), action).toBe(NOW);
      expect(harness.db.sales[0].workflow_status_changed_at.toISOString(), action).toBe(NOW);
    }
  });

  // mark_paid before a local handoff records the payment but deliberately keeps
  // the sale on AWAITING_HANDOFF, so there is no status change to stamp.
  it('does not stamp a sale transition that records a payment without moving the status', async () => {
    const prepaid = seedSale({
      workflow_status: 'AWAITING_HANDOFF', workflow_type: 'DIRECT_LOCAL', workflow_status_changed_at: EARLIER,
    });
    const result = await run('sale', prepaid, 'mark_paid', { paid_at: NOW, paid_amount: '120.00', now: NOW });
    expect(result.to).toBe('AWAITING_HANDOFF');
    expect(result.data.workflow_status_changed_at).toBeUndefined();
    expect(harness.db.sales[0].paid_at.toISOString()).toBe(NOW);
    expect(harness.db.sales[0].workflow_status_changed_at.toISOString()).toBe(EARLIER.toISOString());

    // The handoff that follows does move the status, and stamps it.
    const handed = await run('sale', { ...harness.db.sales[0], user_id: harness.ids.user }, 'mark_handed_over', { now: NOW });
    expect(handed.to).toBe('PAID');
    expect(harness.db.sales[0].workflow_status_changed_at.toISOString()).toBe(NOW);
  });

  // The stamp rides in the same guarded updateMany as the status, so a rejected
  // transition cannot leave a record claiming it just moved.
  it('writes no stamp at all when the guarded update is rejected', async () => {
    const stale = seedSale({ workflow_status_changed_at: EARLIER });
    harness.db.sales[0].workflow_status = 'PAID'; // a concurrent request won
    await expect(run('sale', stale, 'void_sale', { now: NOW })).rejects.toThrow(/changed while saving/);
    expect(harness.db.sales[0].workflow_status_changed_at.toISOString()).toBe(EARLIER.toISOString());

    const staleInventory = seedInventory('PURCHASED', { receiving_status_changed_at: EARLIER });
    harness.db.inventory[0].receiving_status = 'ON_HAND';
    await expect(run('inventory', staleInventory, 'mark_on_hand', { now: NOW })).rejects.toThrow(/changed while saving/);
    expect(harness.db.inventory[0].receiving_status_changed_at.toISOString()).toBe(EARLIER.toISOString());
  });
});
