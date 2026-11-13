// The Dashboard's per-workflow Status Pipeline (Cash-out / Marketplace):
// units, money and items in each step, built from the dashboard's own
// mode/date-filtered sales.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildWorkflowPipelines, ITEMS_PER_STAGE } = require('../services/workflowPipeline');
const harness = require('../../qa/harness.cjs');

const cashoutPlatform = { id: 'p-eb', name: 'EB', type: 'Cashout', workflow_preset: 'CASHOUT' };
const ebay = { id: 'p-ebay', name: 'eBay', type: 'Marketplace', workflow_preset: 'STANDARD_MARKETPLACE' };
let n = 0;
const sale = (fields = {}) => ({
  id: `s${++n}`,
  inventory_id: `i${n}`,
  inventory: { product_name: `Item ${n}` },
  platform: cashoutPlatform,
  quantity: 1,
  refunded_qty: 0,
  unit_price: 100,
  sale_date: '2026-11-01',
  ...fields,
});
const stage = (pipeline, status) => pipeline.stages.find((s) => s.status === status);

describe('buildWorkflowPipelines', () => {
  it('lists every Cash-out step in order, with units, money and items in each', () => {
    const { cashout } = buildWorkflowPipelines([
      sale({ workflow_status: 'OUTBOUND', quantity: 3, unit_price: 480, workflow_status_changed_at: '2026-11-10' }),
      sale({ workflow_status: 'OUTBOUND', quantity: 1, unit_price: 99.99, workflow_status_changed_at: '2026-11-12' }),
      sale({ workflow_status: 'PAID' }),
    ]);
    expect(cashout.stages.map((s) => s.status)).toEqual([
      'AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_PROVIDER', 'WAITING_FOR_SCAN_IN', 'SCANNED_IN', 'ACCEPTED', 'WAITING_FOR_PAYMENT', 'PAID',
    ]);
    const outbound = stage(cashout, 'OUTBOUND');
    expect(outbound).toMatchObject({ count: 4, value: 1539.99, itemCount: 2 });
    expect(outbound.items[0]).toMatchObject({ name: 'Item 2', party: 'EB', quantity: 1, value: 99.99 }); // newest first
    expect(stage(cashout, 'PAID').count).toBe(1);
    expect(stage(cashout, 'SCANNED_IN')).toMatchObject({ count: 0, value: 0, items: [] });
  });

  it('keeps Cash-out and Marketplace sales apart by the platform sold to, like the dashboard filter', () => {
    const { cashout, marketplace } = buildWorkflowPipelines([
      sale({ workflow_status: 'AWAITING_SHIPMENT' }),
      sale({ platform: ebay, workflow_status: 'AWAITING_SHIPMENT', unit_price: 50 }),
      sale({ platform: null, workflow_status: 'AWAITING_SHIPMENT', unit_price: 7 }), // no platform: Marketplace
    ]);
    expect(stage(cashout, 'AWAITING_SHIPMENT')).toMatchObject({ count: 1, value: 100 });
    expect(stage(marketplace, 'AWAITING_SHIPMENT')).toMatchObject({ count: 2, value: 57 });
  });

  it('counts a cash-out sale under Cash-out even when it carries the standard-marketplace workflow', () => {
    // How most older cash-out sales are stored: platform preset unset, the
    // sale's workflow_type left at the standard-marketplace default.
    const noPreset = { ...cashoutPlatform, workflow_preset: null };
    const { cashout, marketplace } = buildWorkflowPipelines([
      sale({ platform: noPreset, workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'PAID' }),
      sale({ platform: noPreset, workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT' }),
      sale({ platform: noPreset, workflow_type: null, workflow_status: null, status: 'SHIPPED_OUT' }),
    ]);
    expect(stage(cashout, 'PAID').count).toBe(1);
    expect(stage(cashout, 'WAITING_FOR_PAYMENT').count).toBe(1);
    expect(stage(cashout, 'OUTBOUND').count).toBe(1);
    expect(marketplace.stages.reduce((sum, s) => sum + s.count, 0)).toBe(0);
  });

  it('places a row from before the status workflow by its legacy status', () => {
    const { cashout, marketplace } = buildWorkflowPipelines([
      sale({ status: 'SOLD', workflow_status: null }),
      sale({ status: 'SHIPPED_OUT', workflow_status: null }),
      sale({ platform: ebay, status: 'PAID', workflow_status: null }),
    ]);
    expect(stage(cashout, 'AWAITING_SHIPMENT').count).toBe(1);
    expect(stage(cashout, 'OUTBOUND').count).toBe(1);
    expect(stage(marketplace, 'PAID').count).toBe(1);
  });

  it('leaves out cancelled, returned and disputed sales, and units the buyer returned', () => {
    const { cashout } = buildWorkflowPipelines([
      sale({ workflow_status: 'CANCELLED' }),
      sale({ workflow_status: 'RETURNED' }),
      sale({ workflow_status: 'OUTBOUND', quantity: 3, refunded_qty: 1, unit_price: 10 }),
      sale({ workflow_status: 'OUTBOUND', quantity: 2, refunded_qty: 2 }),
    ]);
    const total = cashout.stages.reduce((sum, s) => sum + s.count, 0);
    expect(total).toBe(2);
    expect(stage(cashout, 'OUTBOUND')).toMatchObject({ count: 2, value: 20, itemCount: 1 });
  });

  it('shows Marketplace\'s authentication and handoff steps only when something is in them', () => {
    expect(buildWorkflowPipelines([]).marketplace.stages.map((s) => s.status))
      .toEqual(['AWAITING_SHIPMENT', 'OUTBOUND', 'WAITING_FOR_PAYMENT', 'PAID']);
    const { marketplace } = buildWorkflowPipelines([
      sale({ platform: { ...ebay, workflow_preset: 'AUTH_MARKETPLACE' }, workflow_status: 'AUTHENTICATING' }),
    ]);
    expect(marketplace.stages.map((s) => s.status)).toContain('AUTHENTICATING');
    expect(marketplace.stages.map((s) => s.status)).not.toContain('HANDED_OVER');
  });

  it('puts everything in the All view: unsold stock at cost first, then both kinds of sales', () => {
    const stock = [
      { id: 'inv-a', product_name: 'Switch 2', receiving_status: 'ON_HAND', qty_on_hand: 3, qty_purchased: 4, unit_purchase_cost: 400, vendor: { name: 'Best Buy' } },
      { id: 'inv-b', product_name: 'Old row', status: 'SHIPPED_IN', qty_on_hand: 1, qty_purchased: 1, unit_purchase_cost: 50 }, // legacy status
      { id: 'inv-c', product_name: 'Sold out', receiving_status: 'ON_HAND', qty_on_hand: 0, qty_purchased: 2, unit_purchase_cost: 10 },
    ];
    const { all, cashout } = buildWorkflowPipelines([
      sale({ workflow_status: 'SCANNED_IN' }),
      sale({ platform: ebay, workflow_status: 'OUTBOUND', unit_price: 60 }),
    ], stock);

    expect(all.stages.map((s) => s.status).slice(0, 3)).toEqual(['PURCHASED', 'INBOUND', 'ON_HAND']);
    expect(stage(all, 'ON_HAND')).toMatchObject({ count: 3, value: 1200, itemCount: 1 });
    expect(stage(all, 'ON_HAND').items[0]).toMatchObject({ name: 'Switch 2', party: 'Best Buy', quantity: 3 });
    expect(stage(all, 'INBOUND').count).toBe(1);
    expect(stage(all, 'SCANNED_IN').count).toBe(1); // a Cash-out step
    expect(stage(all, 'OUTBOUND')).toMatchObject({ count: 1, value: 60 }); // a Marketplace sale
    // Stock is only in All.
    expect(cashout.stages.map((s) => s.status)).not.toContain('ON_HAND');
  });

  it("hides All's rarely used steps until something is in them", () => {
    const statuses = buildWorkflowPipelines([], []).all.stages.map((s) => s.status);
    expect(statuses).not.toContain('PRE_ORDER');
    expect(statuses).not.toContain('AUTHENTICATING');
    expect(statuses).toContain('SCANNED_IN');
  });

  it('lists at most a page of items per step, while the count and value cover them all', () => {
    const many = Array.from({ length: ITEMS_PER_STAGE + 5 }, () => sale({ workflow_status: 'PAID' }));
    const paid = stage(buildWorkflowPipelines(many).cashout, 'PAID');
    expect(paid.items).toHaveLength(ITEMS_PER_STAGE);
    expect(paid.itemCount).toBe(ITEMS_PER_STAGE + 5);
    expect(paid.count).toBe(ITEMS_PER_STAGE + 5);
    expect(paid.value).toBe((ITEMS_PER_STAGE + 5) * 100);
  });
});

describe('GET /api/analytics/dashboard workflowPipelines', () => {
  let server;
  let baseUrl;
  beforeAll(async () => {
    server = harness.app().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  beforeEach(() => harness.reset());
  afterAll(() => server.close());

  it('returns both workflow pipelines, built from the dashboard\'s own sales', async () => {
    const res = await fetch(`${baseUrl}/api/analytics/dashboard?mode=All&date=All%20Time`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Object.keys(body.workflowPipelines)).toEqual(['all', 'cashout', 'marketplace']);
    const units = (pipeline) => pipeline.stages.reduce((sum, s) => sum + s.count, 0);
    // The fixture's one sale is a 2-unit marketplace sale.
    expect(units(body.workflowPipelines.marketplace)).toBe(2);
    expect(units(body.workflowPipelines.cashout)).toBe(0);
    // All also counts the fixture's unsold stock (All mode only).
    expect(units(body.workflowPipelines.all)).toBeGreaterThan(2);
    const filtered = await (await fetch(`${baseUrl}/api/analytics/dashboard?mode=Marketplace&date=All%20Time`)).json();
    expect(units(filtered.workflowPipelines.all)).toBe(2);
  });
});
