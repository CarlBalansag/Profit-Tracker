import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const {
  migrateStatusWorkflow,
  mapInventoryRow,
  mapSaleRow,
  LEGACY_INVENTORY_STATUSES,
  LEGACY_SALE_STATUSES,
} = require('../scripts/migrateStatusWorkflow.js');

const NOW = new Date('2026-10-01T12:00:00Z');
const inv = (overrides = {}) => ({ id: 'inv-1', status: 'PURCHASED', qty_on_hand: 1, received_date: null, sales: [], ...overrides });
const sale = (overrides = {}) => ({ id: 'sale-1', status: 'SOLD', payout_date: null, platform: null, ...overrides });

describe('legacy Inventory status mapping', () => {
  // The exact 15 literals in validation/schemas.js INVENTORY_STATUSES.
  const expectations = [
    ['Pre Order', 'PRE_ORDER'],
    ['PURCHASED', 'PURCHASED'],
    ['SHIPPED_IN', 'INBOUND'],
    ['On Hand', 'ON_HAND'],
    ['DELIVERED', 'ON_HAND'],
    ['SCANNED_IN', 'ON_HAND'],
    ['LISTED', 'ON_HAND'],
  ];

  it.each(expectations)('maps unambiguous legacy "%s" to %s', (legacy, receiving) => {
    const decision = mapInventoryRow(inv({ status: legacy }));
    expect(decision.ambiguous).toBe(false);
    expect(decision.data.receiving_status).toBe(receiving);
  });

  it('turns LISTED into a receiving status plus the listing attribute', () => {
    expect(mapInventoryRow(inv({ status: 'LISTED' })).data).toMatchObject({ receiving_status: 'ON_HAND', is_listed: true });
    // Nothing else sets is_listed, so an unlisted purchase keeps the column default.
    expect(mapInventoryRow(inv({ status: 'DELIVERED' })).data.is_listed).toBeUndefined();
  });

  it('carries over a real received_date and never invents one', () => {
    const received = new Date('2026-08-01T00:00:00Z');
    expect(mapInventoryRow(inv({ status: 'DELIVERED', received_date: received })).data.received_at).toBe(received);
    expect(mapInventoryRow(inv({ status: 'DELIVERED' })).data.received_at).toBeNull();
    // A row that never arrived gets no received_at field at all.
    expect(mapInventoryRow(inv({ status: 'SHIPPED_IN', received_date: received })).data.received_at).toBeUndefined();
  });

  it.each([
    ['RETURNED', 'returned_with_stock_on_hand'],
    ['DISPUTED', 'disputed_with_stock_on_hand'],
  ])('maps legacy "%s" to ON_HAND only while units are physically present', (legacy, rule) => {
    const withStock = mapInventoryRow(inv({ status: legacy, qty_on_hand: 2 }));
    expect(withStock).toMatchObject({ ambiguous: false, rule });
    expect(withStock.data.receiving_status).toBe('ON_HAND');
    expect(mapInventoryRow(inv({ status: legacy, qty_on_hand: 0 })).ambiguous).toBe(true);
  });

  it('refuses to guess a receiving status for a legacy CANCELLED purchase', () => {
    const decision = mapInventoryRow(inv({ status: 'CANCELLED' }));
    expect(decision).toMatchObject({ ambiguous: true, data: null });
    expect(decision.reason).toMatch(/no recorded cancellation date/);
  });

  it.each(['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED'])(
    'reconstructs sale-only legacy status "%s" from linked sales instead of mapping it directly', (legacy) => {
      // Sold out with a linked sale: the purchase itself clearly arrived, and
      // the sale row carries the sale-side status on its own.
      const soldOut = mapInventoryRow(inv({ status: legacy, qty_on_hand: 0, sales: [{ id: 'sale-a' }] }));
      expect(soldOut).toMatchObject({ ambiguous: false, rule: 'sale_only_sold_out_with_linked_sale', linked_sale_ids: ['sale-a'] });
      expect(soldOut.data.receiving_status).toBe('ON_HAND');

      // Partially sold from a multi-unit batch: same conclusion, separate rule
      // so the report distinguishes the two.
      const partial = mapInventoryRow(inv({ status: legacy, qty_on_hand: 3, sales: [{ id: 'sale-a' }, { id: 'sale-b' }] }));
      expect(partial).toMatchObject({ ambiguous: false, rule: 'sale_only_partial_with_linked_sale' });
      expect(partial.data.receiving_status).toBe('ON_HAND');

      // No linked sale at all: there is nothing to reconstruct from.
      const orphan = mapInventoryRow(inv({ status: legacy, qty_on_hand: 0, sales: [] }));
      expect(orphan).toMatchObject({ ambiguous: true, data: null, linked_sale_ids: [] });
      expect(orphan.reason).toMatch(/no linked sale/);
    });

  it('covers all 15 legacy inventory literals and flags anything outside that vocabulary', () => {
    expect(LEGACY_INVENTORY_STATUSES).toHaveLength(15);
    for (const legacy of LEGACY_INVENTORY_STATUSES) {
      const decision = mapInventoryRow(inv({ status: legacy, qty_on_hand: 2, sales: [{ id: 'sale-a' }] }));
      expect(decision.legacy_status, legacy).toBe(legacy);
      // Every literal is either mapped to a canonical receiving status or
      // explicitly flagged -- never silently dropped.
      if (decision.ambiguous) expect(decision.reason, legacy).toBeTruthy();
      else expect(['PRE_ORDER', 'PURCHASED', 'INBOUND', 'ON_HAND'], legacy).toContain(decision.data.receiving_status);
    }
    expect(mapInventoryRow(inv({ status: 'WAT' }))).toMatchObject({ ambiguous: true });
    expect(mapInventoryRow(inv({ status: null }))).toMatchObject({ ambiguous: true });
  });
});

describe('legacy Sales status mapping', () => {
  it.each([
    ['SOLD', 'AWAITING_SHIPMENT'],
    ['SHIPPED_OUT', 'OUTBOUND'],
    ['AUTHENTICATION', 'AUTHENTICATING'],
    ['RETURNED', 'RETURNED'],
    ['DISPUTED', 'DISPUTED'],
    ['CANCELLED', 'CANCELLED'],
  ])('maps legacy "%s" to %s', (legacy, workflow_status) => {
    const decision = mapSaleRow(sale({ status: legacy }), NOW);
    expect(decision.ambiguous).toBe(false);
    expect(decision.data.workflow_status).toBe(workflow_status);
  });

  it('maps legacy PAID to PAID and uses payout_date as the only paid_at evidence', () => {
    const payout = new Date('2026-09-15T00:00:00Z');
    const dated = mapSaleRow(sale({ status: 'PAID', payout_date: payout }), NOW);
    expect(dated.data).toMatchObject({ workflow_status: 'PAID' });
    expect(dated.data.paid_at.toISOString()).toBe(payout.toISOString());
    expect(mapSaleRow(sale({ status: 'PAID' }), NOW).data.paid_at).toBeNull();
  });

  it('promotes legacy COMPLETED to PAID only with independent payment evidence', () => {
    const past = mapSaleRow(sale({ status: 'COMPLETED', payout_date: new Date('2026-09-15T00:00:00Z') }), NOW);
    expect(past).toMatchObject({ ambiguous: false, rule: 'completed_to_paid_with_payout_evidence' });
    expect(past.data.workflow_status).toBe('PAID');

    const none = mapSaleRow(sale({ status: 'COMPLETED' }), NOW);
    expect(none).toMatchObject({ ambiguous: true, data: null });
    expect(none.reason).toMatch(/no payout_date/);

    const future = mapSaleRow(sale({ status: 'COMPLETED', payout_date: new Date('2026-12-01T00:00:00Z') }), NOW);
    expect(future).toMatchObject({ ambiguous: true, data: null });
    expect(future.reason).toMatch(/still in the future/);
  });

  it('derives workflow_type from the platform type, with AUTHENTICATION as its own evidence', () => {
    expect(mapSaleRow(sale({ platform: { type: 'Marketplace' } }), NOW).data.workflow_type).toBe('STANDARD_MARKETPLACE');
    expect(mapSaleRow(sale({ platform: { type: 'Cashout' } }), NOW).data.workflow_type).toBe('CASHOUT');
    expect(mapSaleRow(sale({ platform: null }), NOW).data.workflow_type).toBe('STANDARD_MARKETPLACE');
    expect(mapSaleRow(sale({ status: 'AUTHENTICATION', platform: { type: 'Marketplace' } }), NOW).data.workflow_type).toBe('AUTH_MARKETPLACE');
    // A cash-out sale still starts on the shared AWAITING_SHIPMENT step.
    expect(mapSaleRow(sale({ status: 'SOLD', platform: { type: 'Cashout' } }), NOW).data.workflow_status).toBe('AWAITING_SHIPMENT');
  });

  it('covers all 8 legacy sale literals and flags anything outside that vocabulary', () => {
    expect(LEGACY_SALE_STATUSES).toHaveLength(8);
    for (const legacy of LEGACY_SALE_STATUSES) {
      const decision = mapSaleRow(sale({ status: legacy, payout_date: new Date('2026-09-01T00:00:00Z') }), NOW);
      expect(decision, legacy).toMatchObject({ ambiguous: false, table: 'Sales', legacy_status: legacy });
      expect(decision.data.workflow_status, legacy).toBeTruthy();
    }
    expect(mapSaleRow(sale({ status: 'PURCHASED' }), NOW)).toMatchObject({ ambiguous: true });
  });
});

describe('migrateStatusWorkflow script', () => {
  let logged;
  let written;
  const fileSystem = { writeFileSync: (path, contents) => { written = { path, contents }; } };
  const run = (args) => migrateStatusWorkflow({ prisma: harness.prisma, args, fileSystem, outputLog: (line) => logged.push(line), now: NOW });

  beforeEach(() => {
    harness.reset();
    logged = [];
    written = null;
    // One clean purchase, one ambiguous purchase, and a COMPLETED sale with no
    // payment evidence, so each report section has content.
    harness.db.inventory.push({ ...harness.db.inventory[0], id: 'inv-cancelled', status: 'CANCELLED', qty_on_hand: 0 });
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sale-completed', status: 'COMPLETED', payout_date: null });
  });

  it('writes only the report in dry-run mode and leaves every row untouched', async () => {
    const summary = await run([]);
    expect(summary).toMatchObject({ dryRun: true, inventoryRows: 2, saleRows: 2, autoMapped: 2, ambiguous: 2 });
    expect(written.path).toMatch(/qa[\\/]STATUS_MIGRATION_REPORT\.md$/);
    expect(harness.db.inventory.every((row) => row.receiving_status === undefined)).toBe(true);
    expect(harness.db.sales.every((row) => row.workflow_status === undefined)).toBe(true);
    // Legacy statuses are never rewritten, in either mode.
    expect(harness.db.inventory.map((row) => row.status)).toEqual(['PURCHASED', 'CANCELLED']);
    expect(JSON.parse(logged[0])).toMatchObject({ dryRun: true });
  });

  it('reports totals, per-rule counts and every ambiguous row with its reason', async () => {
    await run([]);
    expect(written.contents).toContain('# Status workflow — legacy status migration report');
    expect(written.contents).toContain('Mode: dry run (no database writes)');
    expect(written.contents).toContain('| Inventory | 2 | 1 | 1 |');
    expect(written.contents).toContain('| Sales | 2 | 1 | 1 |');
    expect(written.contents).toContain('| **Total** | **4** | **2** | **2** |');
    expect(written.contents).toContain('| purchased | 1 |');
    expect(written.contents).toContain('| sold_to_awaiting_shipment | 1 |');
    expect(written.contents).toContain('inv-cancelled');
    expect(written.contents).toContain('sale-completed');
    expect(written.contents).toMatch(/no independent evidence of payment/);
  });

  it('backfills the new columns with --apply, skipping ambiguous rows', async () => {
    const summary = await run(['--apply']);
    expect(summary).toMatchObject({ dryRun: false, autoMapped: 2, ambiguous: 2, written: 2, skippedChangedRows: 0 });
    expect(written.contents).toContain('Mode: **applied** (new columns written)');
    const [clean, cancelled] = harness.db.inventory;
    expect(clean).toMatchObject({ status: 'PURCHASED', receiving_status: 'PURCHASED' });
    expect(cancelled.receiving_status).toBeUndefined();
    const [sold, completed] = harness.db.sales;
    expect(sold).toMatchObject({ status: 'SOLD', workflow_status: 'AWAITING_SHIPMENT', workflow_type: 'STANDARD_MARKETPLACE' });
    expect(completed.workflow_status).toBeUndefined();
  });

  it('is idempotent and skips a row whose legacy status changed under it', async () => {
    await run(['--apply']);
    const second = await run(['--apply']);
    expect(second.written).toBe(2);
    expect(harness.db.inventory[0].receiving_status).toBe('PURCHASED');

    // The guard is on the legacy status the decision was made from: a row that
    // no longer matches it is skipped, not overwritten.
    const original = harness.prisma.inventory.updateMany;
    harness.prisma.inventory.updateMany = async () => ({ count: 0 });
    try {
      const third = await run(['--apply']);
      expect(third).toMatchObject({ written: 1, skippedChangedRows: 1 });
    } finally {
      harness.prisma.inventory.updateMany = original;
    }
  });

  it('accepts an explicit report path', async () => {
    await run(['--report', 'custom/report.md']);
    expect(written.path).toBe('custom/report.md');
  });
});
