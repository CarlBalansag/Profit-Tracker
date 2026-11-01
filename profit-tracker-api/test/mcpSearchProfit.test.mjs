import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const payload = await response.json();
  if (payload.error) return { rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { isError: result.isError || false, data };
}
const rejected = (res) => Boolean(res.rpcError || res.isError);

const BUYER = '99999999-9999-4999-8999-0000000000c1';
const OTHER_INV = '99999999-9999-4999-8999-0000000000a1';
const OTHER_SALE = '99999999-9999-4999-8999-0000000000a2';
const SECOND_INV = '99999999-9999-4999-8999-0000000000b1';
const SECOND_SALE = '99999999-9999-4999-8999-0000000000b2';
const VOIDED_SALE = '99999999-9999-4999-8999-0000000000b3';
const CANCELLED_INV = '99999999-9999-4999-8999-0000000000b4';
const MISSING = '99999999-9999-4999-8999-0000000000ff';

function seedNote(fields) {
  const created = fields.created_at || new Date('2026-09-10T12:00:00Z');
  const note = {
    id: crypto.randomUUID(), user_id: ids.user, entity_type: 'purchase', entity_id: ids.inventory, body: 'seeded',
    author: 'carl', pinned: false, created_at: created, updated_at: created, deleted_at: null, ...fields,
  };
  harness.db.transactionNote.push(note);
  return note;
}

// Search fixture: order number on the base purchase, a tracking number + named
// buyer on the base sale, and another user's same-named purchase/sale/note.
function seedSearch() {
  harness.db.inventory[0].order_number = 'ORD-777';
  harness.db.sales[0].tracking_number = 'SALETRK123';
  harness.db.sales[0].buyer_id = BUYER;
  harness.db.buyer.push({ id: BUYER, user_id: ids.user, name: 'Jane Reseller' });
  harness.db.inventory.push({
    id: OTHER_INV, user_id: ids.other, product_name: 'QA Multi-unit Sneaker', order_number: 'ORD-777',
    qty_purchased: 1, qty_on_hand: 0, unit_purchase_cost: 10, purchase_date: new Date('2026-09-20T12:00:00Z'),
  });
  harness.db.sales.push({
    id: OTHER_SALE, inventory_id: OTHER_INV, platform_id: ids.foreign, quantity: 1, unit_price: 20,
    tracking_number: 'SALETRK123', sale_date: new Date('2026-09-21T12:00:00Z'),
  });
  seedNote({ user_id: ids.other, entity_id: OTHER_INV, body: 'Box was dented, other user' });
}

const ownIds = () => new Set([
  ...harness.db.inventory.filter((i) => i.user_id === ids.user).map((i) => i.id),
  ...harness.db.sales.filter((s) => s.inventory_id !== OTHER_INV).map((s) => s.id),
  ...harness.db.transactionNote.filter((n) => n.user_id === ids.user).map((n) => n.id),
]);

describe('search', () => {
  it('matches a purchase by product name and a sale by its purchase\'s product name, compact rows newest first', async () => {
    seedSearch();
    const { isError, data } = await callTool('search', { query: 'multi-UNIT sneaker', types: ['purchase', 'sale'] });
    expect(isError).toBe(false);
    // Sale 2026-09-03 is newer than purchase 2026-09-01. Other user's rows (09-20/21) absent.
    expect(data.truncated).toBe(false);
    expect(data.results).toEqual([
      // amount = saleEconomics revenue = 2*150 - 15 commission - 12 shipping = 273
      { id: ids.sale, type: 'sale', name: 'QA Multi-unit Sneaker', date: '2026-09-03', amount: 273, status: 'SOLD' },
      // amount = batchCost = 100*5 + 40 tax + 20 ship + 10 fees - 50 gift card = 520
      { id: ids.inventory, type: 'purchase', name: 'QA Multi-unit Sneaker', date: '2026-09-01', amount: 520, status: 'PURCHASED', availability: 'Available' },
    ]);
  });

  it('matches by order number (purchase and its sale), tracking, store, platform and buyer', async () => {
    seedSearch();
    const pick = (res) => res.data.results.map((r) => `${r.type}:${r.id}`).sort();

    expect(pick(await callTool('search', { query: 'ord-777' }))).toEqual([`purchase:${ids.inventory}`, `sale:${ids.sale}`].sort());
    // Purchase tracking number only matches the purchase.
    expect(pick(await callTool('search', { query: '9400111899' }))).toEqual([`purchase:${ids.inventory}`]);
    // Sale tracking number only matches the sale.
    expect(pick(await callTool('search', { query: 'saletrk' }))).toEqual([`sale:${ids.sale}`]);
    // Store (vendor) name matches the purchase.
    expect(pick(await callTool('search', { query: 'qa store' }))).toEqual([`purchase:${ids.inventory}`]);
    // Platform name matches the sale.
    expect(pick(await callTool('search', { query: 'marketplace' }))).toEqual([`sale:${ids.sale}`]);
    // Buyer name matches the sale.
    expect(pick(await callTool('search', { query: 'jane' }))).toEqual([`sale:${ids.sale}`]);
  });

  it('matches note bodies, excludes soft-deleted notes and other users\' notes', async () => {
    seedSearch();
    const live = seedNote({ body: 'Box was DENTED on arrival', created_at: new Date('2026-09-12T08:00:00Z') });
    seedNote({ body: 'box was dented (deleted)', deleted_at: new Date() });
    const { data } = await callTool('search', { query: 'dented' });
    expect(data.results).toEqual([{
      id: live.id, type: 'note', name: 'Box was DENTED on arrival', date: '2026-09-12', amount: null, status: 'purchase', parent_id: ids.inventory,
    }]);
  });

  it('truncates note names to 80 characters', async () => {
    const body = `${'x'.repeat(90)} needle`;
    seedNote({ body });
    const { data } = await callTool('search', { query: 'needle' });
    expect(data.results[0].name).toBe('x'.repeat(80));
  });

  it('defaults limit to 10 and reports truncated; types filter narrows', async () => {
    for (let i = 0; i < 12; i += 1) seedNote({ body: `bulk note ${i}`, created_at: new Date(Date.UTC(2026, 8, 1 + i, 12)) });
    const first = await callTool('search', { query: 'bulk' });
    expect(first.data.results).toHaveLength(10);
    expect(first.data.truncated).toBe(true);
    // Newest first: note 11 (2026-09-12) leads.
    expect(first.data.results[0]).toMatchObject({ name: 'bulk note 11', date: '2026-09-12' });

    const all = await callTool('search', { query: 'bulk', limit: 50 });
    expect(all.data.results).toHaveLength(12);
    expect(all.data.truncated).toBe(false);

    const exact = await callTool('search', { query: 'bulk', limit: 12 });
    expect(exact.data.truncated).toBe(false);

    const none = await callTool('search', { query: 'bulk', types: ['purchase', 'sale'] });
    expect(none.data).toEqual({ results: [], truncated: false });
  });

  it('never returns another user\'s rows', async () => {
    seedSearch();
    const own = ownIds();
    for (const query of ['sneaker', 'ord-777', 'saletrk', 'dented', 'qa']) {
      const { data } = await callTool('search', { query, limit: 50 });
      for (const row of data.results) expect(own.has(row.id)).toBe(true);
      expect(data.results.some((r) => r.id === OTHER_INV || r.id === OTHER_SALE)).toBe(false);
    }
  });

  it('reports CANCELLED for a cancelled purchase', async () => {
    harness.db.inventory[0].cancelled_at = new Date();
    const { data } = await callTool('search', { query: 'sneaker', types: ['purchase'] });
    expect(data.results[0].status).toBe('CANCELLED');
  });

  it('rejects bad input', async () => {
    expect(rejected(await callTool('search', {}))).toBe(true);
    expect(rejected(await callTool('search', { query: '' }))).toBe(true);
    expect(rejected(await callTool('search', { query: '   ' }))).toBe(true);
    expect(rejected(await callTool('search', { query: 'x'.repeat(201) }))).toBe(true);
    expect(rejected(await callTool('search', { query: 'x', limit: 51 }))).toBe(true);
    expect(rejected(await callTool('search', { query: 'x', types: ['expense'] }))).toBe(true);
  });
});

// Base harness fixture (both purchase and product scope use it):
//   purchase: unit 100 x 5, tax 40, inbound ship 20, fees 10, gift card 50,
//     no cashback_rate -> card default 2%.
//     batchCost = 500 + 40 + 20 + 10 - 50 = 520; cashback = 520 * 2% = 10.40
//   sale: qty 2 @ 150, commission 15, sale shipping 12
//     revenue = 300 - 15 - 12 = 273
//     cost    = 520 * 2/5 = 208
//     cashback = 10.40 * 2/5 = 4.16
//     netProfit = 273 - 208 + 4.16 = 69.16
//     roi = 69.16 / 208 * 100 = 33.25
describe('get_item_profit', () => {
  it('purchase scope: the purchase and all its realized sales', async () => {
    const { isError, data } = await callTool('get_item_profit', { purchase_id: ids.inventory });
    expect(isError).toBe(false);
    expect(data).toEqual({
      scope: 'purchase', product: 'QA Multi-unit Sneaker',
      units_bought: 5, units_sold: 2, units_on_hand: 3, availability: 'Available',
      total_cost: 520,
      revenue: 300, // 2 x 150 gross
      fees: 15, shipping: 12, // sale commission and sale shipping
      cost_of_units_sold: 208, // 520 * 2/5
      purchase_fees_and_shipping: 12, // (10 fees + 20 inbound) * 2/5, inside cost_of_units_sold
      profit_before_cashback: 65, // 300 - 15 - 12 - 208
      cashback: 4.16, // 2% of 520 * 2/5
      net_profit: 69.16, roi_pct: 33.25,
      sales_count: 1, excluded_sales: 0,
    });
  });

  it('sale scope: one sale, cost = allocated cost of its units', async () => {
    const { data } = await callTool('get_item_profit', { sale_id: ids.sale });
    expect(data).toEqual({
      scope: 'sale', product: 'QA Multi-unit Sneaker',
      units_bought: 2, units_sold: 2, units_on_hand: null, availability: null,
      total_cost: 208, cost_of_units_sold: 208, // 520 * 2/5
      revenue: 300, fees: 15, shipping: 12, purchase_fees_and_shipping: 12,
      profit_before_cashback: 65, cashback: 4.16, net_profit: 69.16, roi_pct: 33.25,
      sales_count: 1, excluded_sales: 0,
    });
  });

  it('product scope: same-named purchases (case/whitespace-insensitive), skipping cancelled purchases, voided sales and other users', async () => {
    // Second purchase: 50 x 2, no tax/ship/fees/gift card, cashback_rate 0.
    //   batchCost = 100. Realized sale qty 1 @ 80, commission 8, ship 2:
    //   revenue = 80 - 8 - 2 = 70, cost = 100 * 1/2 = 50, cashback 0, net = 20.
    //   The voided sale (qty 1 @ 90) is excluded.
    harness.db.inventory.push(
      { id: SECOND_INV, user_id: ids.user, product_name: '  qa MULTI-unit sneaker ', unit_purchase_cost: 50, qty_purchased: 2, qty_on_hand: 1,
        sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, cashback_rate: 0, cashback_earned: 0, status: 'PURCHASED',
        purchase_date: new Date('2026-09-05T12:00:00Z') },
      { id: CANCELLED_INV, user_id: ids.user, product_name: 'QA Multi-unit Sneaker', unit_purchase_cost: 999, qty_purchased: 1, qty_on_hand: 1,
        cancelled_at: new Date(), receiving_status: 'CANCELLED', purchase_date: new Date('2026-09-06T12:00:00Z') },
      { id: OTHER_INV, user_id: ids.other, product_name: 'QA Multi-unit Sneaker', unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 0,
        purchase_date: new Date('2026-09-07T12:00:00Z') },
    );
    harness.db.sales.push(
      { id: SECOND_SALE, inventory_id: SECOND_INV, platform_id: ids.platform, quantity: 1, unit_price: 80, commission_fee: 8, sale_shipping: 2,
        status: 'SOLD', sale_date: new Date('2026-09-08T12:00:00Z') },
      { id: VOIDED_SALE, inventory_id: SECOND_INV, platform_id: ids.platform, quantity: 1, unit_price: 90, commission_fee: 9, sale_shipping: 3,
        status: 'CANCELLED', workflow_status: 'CANCELLED', voided_at: new Date(), sale_date: new Date('2026-09-09T12:00:00Z') },
      { id: OTHER_SALE, inventory_id: OTHER_INV, platform_id: ids.foreign, quantity: 1, unit_price: 500, sale_date: new Date('2026-09-10T12:00:00Z') },
    );
    const { isError, data } = await callTool('get_item_profit', { product: ' qa multi-unit SNEAKER ' });
    expect(isError).toBe(false);
    expect(data).toEqual({
      scope: 'product', product: 'QA Multi-unit Sneaker',
      units_bought: 7, // 5 + 2
      units_sold: 3, // 2 + 1 (voided excluded)
      units_on_hand: 4, // 3 + 1
      availability: 'Available',
      total_cost: 620, // 520 + 100
      revenue: 380, // 300 + 80
      fees: 23, // 15 + 8
      shipping: 14, // 12 + 2
      cost_of_units_sold: 258, // 208 + 50
      purchase_fees_and_shipping: 12, // 12 + 0
      profit_before_cashback: 85, // 380 - 23 - 14 - 258
      cashback: 4.16, // 4.16 + 0
      net_profit: 89.16, // 69.16 + 20
      roi_pct: 34.56, // 89.16 / 258 * 100 = 34.5581...
      sales_count: 2, excluded_sales: 1,
    });
  });

  it('excludes a voided sale (purchase scope and sale scope)', async () => {
    Object.assign(harness.db.sales[0], { voided_at: new Date(), workflow_status: 'CANCELLED', status: 'CANCELLED' });
    const purchase = await callTool('get_item_profit', { purchase_id: ids.inventory });
    expect(purchase.data).toMatchObject({
      units_sold: 0, cost_of_units_sold: 0, revenue: 0, net_profit: 0, roi_pct: null,
      fees: 0, shipping: 0, cashback: 0, purchase_fees_and_shipping: 0, sales_count: 0, excluded_sales: 1, total_cost: 520,
    });
    const sale = await callTool('get_item_profit', { sale_id: ids.sale });
    expect(sale.data).toMatchObject({
      units_sold: 0, revenue: 0, net_profit: 0, fees: 0, shipping: 0, cashback: 0, roi_pct: null, sales_count: 0, excluded_sales: 1,
    });
  });

  it('excludes returned sales', async () => {
    harness.db.sales[0].workflow_status = 'RETURNED';
    const { data } = await callTool('get_item_profit', { purchase_id: ids.inventory });
    expect(data).toMatchObject({ sales_count: 0, excluded_sales: 1, revenue: 0 });
  });

  it('requires exactly one of purchase_id, sale_id, product', async () => {
    expect(rejected(await callTool('get_item_profit', {}))).toBe(true);
    const two = await callTool('get_item_profit', { purchase_id: ids.inventory, sale_id: ids.sale });
    expect(two.isError).toBe(true);
    expect(two.data).toMatch(/exactly one/);
    expect(rejected(await callTool('get_item_profit', { purchase_id: ids.inventory, product: 'x' }))).toBe(true);
    expect(rejected(await callTool('get_item_profit', { purchase_id: 'not-a-uuid' }))).toBe(true);
  });

  it('denies other users\' and missing records', async () => {
    harness.db.inventory.push({ id: OTHER_INV, user_id: ids.other, product_name: 'Private', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 10 });
    harness.db.sales.push({ id: OTHER_SALE, inventory_id: OTHER_INV, platform_id: ids.foreign, quantity: 1, unit_price: 20 });
    for (const args of [{ purchase_id: OTHER_INV }, { sale_id: OTHER_SALE }, { purchase_id: MISSING }, { sale_id: MISSING }]) {
      const res = await callTool('get_item_profit', args);
      expect(res.isError).toBe(true);
      expect(res.data).toMatch(/not found or access denied/);
    }
    const product = await callTool('get_item_profit', { product: 'Private' });
    expect(product.isError).toBe(true);
    expect(product.data).not.toMatch(/Did you mean/);
  });

  it('unknown product errors with up to 5 partial-match suggestions', async () => {
    for (let i = 1; i <= 6; i += 1) {
      harness.db.inventory.push({ id: crypto.randomUUID(), user_id: ids.user, product_name: `Sneaker Variant ${i}`, qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 1 });
    }
    const res = await callTool('get_item_profit', { product: 'sneaker' });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/^No purchases of "sneaker"\. Did you mean: /);
    const suggested = res.data.replace(/^.*Did you mean: /, '').split(', ');
    expect(suggested).toHaveLength(5);
    expect(suggested).toContain('QA Multi-unit Sneaker');

    const none = await callTool('get_item_profit', { product: 'zzz unrelated' });
    expect(none.isError).toBe(true);
    expect(none.data).toBe('No purchases of "zzz unrelated".');
  });
});
