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

const SOLD_OUT_INV = '99999999-9999-4999-8999-0000000000d1';
const SOLD_OUT_SALE = '99999999-9999-4999-8999-0000000000d2';
const OTHER_INV = '99999999-9999-4999-8999-0000000000d3';

// The reported case: one unit bought for 249 on a 5% card, sold for 270 with
// no sale fees or shipping, so it is ON_HAND with nothing left.
function seedSoldOut({ cashbackRate = 5 } = {}) {
  harness.db.inventory.push({
    id: SOLD_OUT_INV, user_id: ids.user, product_name: 'Sold Out Console', unit_purchase_cost: 249, qty_purchased: 1, qty_on_hand: 0,
    sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, cashback_rate: cashbackRate, cashback_earned: 249 * cashbackRate / 100,
    status: 'On Hand', receiving_status: 'ON_HAND', purchase_date: new Date('2026-09-10T12:00:00Z'),
  });
  harness.db.sales.push({
    id: SOLD_OUT_SALE, inventory_id: SOLD_OUT_INV, platform_id: ids.platform, quantity: 1, unit_price: 270, commission_fee: 0, sale_shipping: 0,
    status: 'SOLD', workflow_status: 'AWAITING_SHIPMENT', sale_date: new Date('2026-09-12T12:00:00Z'),
  });
}

const addsUp = (d) => Math.round((d.revenue - d.fees - d.shipping - d.cost_of_units_sold + d.cashback) * 100) / 100;

describe('get_item_profit components', () => {
  it('reports cashback explicitly and the documented formula equals net_profit (reported case)', async () => {
    seedSoldOut();
    const { data } = await callTool('get_item_profit', { purchase_id: SOLD_OUT_INV });
    expect(data).toMatchObject({
      revenue: 270, fees: 0, shipping: 0, cost_of_units_sold: 249,
      profit_before_cashback: 21, cashback: 12.45, net_profit: 33.45,
    });
    expect(addsUp(data)).toBe(data.net_profit);
  });

  it('cashback is 0 and net_profit equals profit_before_cashback with no card cashback', async () => {
    seedSoldOut({ cashbackRate: 0 });
    const { data } = await callTool('get_item_profit', { sale_id: SOLD_OUT_SALE });
    expect(data).toMatchObject({ cashback: 0, profit_before_cashback: 21, net_profit: 21 });
  });

  it('formula holds for the fixture with sale fees, sale shipping and purchase-side costs', async () => {
    for (const args of [{ purchase_id: ids.inventory }, { sale_id: ids.sale }, { product: 'QA Multi-unit Sneaker' }]) {
      const { data } = await callTool('get_item_profit', args);
      expect(addsUp(data)).toBe(data.net_profit);
      expect(data.net_profit).toBe(69.16); // unchanged from before the breakdown
    }
  });

  it('the description states the formula', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/list', params: {} }),
    });
    const tools = (await response.json()).result.tools;
    const tool = tools.find((t) => t.name === 'get_item_profit');
    expect(tool.description).toContain('net_profit = revenue - fees - shipping - cost_of_units_sold + cashback');
  });
});

describe('availability', () => {
  it('a fully sold ON_HAND purchase keeps status ON_HAND and reads Sold Out everywhere', async () => {
    seedSoldOut();
    const { data: list } = await callTool('list_inventory');
    const row = list.items.find((r) => r.id === SOLD_OUT_INV);
    expect(row).toMatchObject({ status: 'ON_HAND', qty_on_hand: 0, availability: 'Sold Out' });
    expect(list.items.find((r) => r.id === ids.inventory).availability).toBe('Available');

    const { data: search } = await callTool('search', { query: 'sold out console', types: ['purchase'] });
    expect(search.results[0]).toMatchObject({ id: SOLD_OUT_INV, availability: 'Sold Out' });

    const { data: profit } = await callTool('get_item_profit', { purchase_id: SOLD_OUT_INV });
    expect(profit).toMatchObject({ units_on_hand: 0, availability: 'Sold Out' });
  });

  it('filters list_inventory by availability, alone and with status', async () => {
    seedSoldOut();
    const soldOut = (await callTool('list_inventory', { availability: 'Sold Out' })).data;
    expect(soldOut.items.map((r) => r.id)).toEqual([SOLD_OUT_INV]);
    const available = (await callTool('list_inventory', { availability: 'Available' })).data;
    expect(available.items.map((r) => r.id)).toEqual([ids.inventory]);
    expect((await callTool('list_inventory', { status: 'on_hand', availability: 'Available' })).data.items).toEqual([]);
    expect(rejected(await callTool('list_inventory', { availability: 'sold' }))).toBe(true);
  });

  it('flips back to Available when the sale is voided, without touching receiving status', async () => {
    seedSoldOut();
    const voided = await callTool('void_sale', { sale_id: SOLD_OUT_SALE, reason: 'entered twice', confirm: true });
    expect(voided.isError).toBe(false);
    const row = (await callTool('list_inventory')).data.items.find((r) => r.id === SOLD_OUT_INV);
    expect(row).toMatchObject({ status: 'ON_HAND', qty_on_hand: 1, availability: 'Available' });
  });
});

describe('list_inventory paging', () => {
  function seedMany(n) {
    for (let i = 0; i < n; i += 1) {
      harness.db.inventory.push({
        id: crypto.randomUUID(), user_id: ids.user, product_name: `Paged ${i}`, unit_purchase_cost: 1, qty_purchased: 1, qty_on_hand: 1,
        status: 'PURCHASED', purchase_date: new Date(Date.UTC(2026, 6, 1 + i, 12)),
      });
    }
  }

  it('defaults to 20 newest rows with total and truncated', async () => {
    seedMany(25); // 26 own purchases with the fixture
    const { data } = await callTool('list_inventory');
    expect(data.items).toHaveLength(20);
    expect(data.total).toBe(26);
    expect(data.truncated).toBe(true);
    expect(data.items[0].id).toBe(ids.inventory); // 2026-09-01, newest
  });

  it('offset pages through the rest without overlap', async () => {
    seedMany(25);
    const first = (await callTool('list_inventory', { limit: 20 })).data.items.map((r) => r.id);
    const second = (await callTool('list_inventory', { limit: 20, offset: 20 })).data;
    expect(second.items).toHaveLength(6);
    expect(second.truncated).toBe(false);
    expect(second.items.some((r) => first.includes(r.id))).toBe(false);
    const past = (await callTool('list_inventory', { offset: 500 })).data;
    expect(past).toEqual({ items: [], total: 26, truncated: false });
  });

  it('pages after filtering, so total counts filtered rows', async () => {
    seedMany(5);
    const { data } = await callTool('list_inventory', { status: 'PURCHASED', limit: 2 });
    expect(data.total).toBe(6);
    expect(data.items).toHaveLength(2);
    expect(data.truncated).toBe(true);
  });

  it('rejects out-of-range limit and offset', async () => {
    for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 2.5 }, { offset: -1 }]) {
      expect(rejected(await callTool('list_inventory', args))).toBe(true);
    }
    expect((await callTool('list_inventory', { limit: 100 })).isError).toBe(false);
  });

  it('never includes another user\'s purchases in items or total', async () => {
    harness.db.inventory.push({ id: OTHER_INV, user_id: ids.other, product_name: 'Theirs', unit_purchase_cost: 1, qty_purchased: 1, qty_on_hand: 1, purchase_date: new Date() });
    const { data } = await callTool('list_inventory');
    expect(data.total).toBe(1);
    expect(data.items.some((r) => r.id === OTHER_INV)).toBe(false);
  });
});
