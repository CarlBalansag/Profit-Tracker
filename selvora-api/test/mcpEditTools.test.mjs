import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
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

describe('update_sale', () => {
  it('edits price/fees/shipping/sale_date/notes and records one change per changed field', async () => {
    const { data } = await callTool('update_sale', {
      sale_id: harness.ids.sale, price: 160, fees: 20, shipping: 5, sale_date: '2026-09-10', notes: 'repackaged',
    });
    expect(data.price).toBe(160);
    expect(data.fees).toBe(20);
    expect(data.shipping).toBe(5);
    expect(data.sale_date).toBe('2026-09-10');
    expect(data.notes).toBe('repackaged');

    const { data: changes } = await callTool('list_changes', { record_id: harness.ids.sale });
    const fields = changes.map((c) => c.field).sort();
    expect(fields).toEqual(['commission_fee', 'notes', 'sale_date', 'sale_shipping', 'unit_price']);
    const priceChange = changes.find((c) => c.field === 'unit_price');
    expect(priceChange.old_value).toBe('150');
    expect(priceChange.new_value).toBe('160');
    expect(priceChange.source).toBe('mcp');
  });

  it('changes which platform (buyer) a sale is attributed to, by name', async () => {
    const { data } = await callTool('update_sale', { sale_id: harness.ids.sale, platform: 'QA Store' });
    expect(data.platform_id).toBe(harness.ids.vendor);
  });

  it('rejects an unknown platform name and lists the real ones', async () => {
    const { isError, data } = await callTool('update_sale', { sale_id: harness.ids.sale, platform: 'Not A Real Platform' });
    expect(isError).toBe(true);
    expect(data).toContain('QA Store');
    expect(data).toContain('QA Marketplace');
  });

  it('adjusts inventory qty_on_hand when the sale quantity changes', async () => {
    // Fixture: inventory qty_on_hand=3, this sale quantity=2. Raising to 3 claims one more unit.
    const before = harness.db.inventory[0].qty_on_hand;
    await callTool('update_sale', { sale_id: harness.ids.sale, qty: 3 });
    expect(harness.db.inventory[0].qty_on_hand).toBe(before - 1);
  });

  it('rejects a quantity increase that would oversell', async () => {
    harness.db.inventory[0].qty_on_hand = 0;
    const { isError } = await callTool('update_sale', { sale_id: harness.ids.sale, qty: 3 });
    expect(isError).toBe(true);
  });

  it('rejects an unknown field (strict schema)', async () => {
    const res = await callTool('update_sale', { sale_id: harness.ids.sale, paid_amount: 999 });
    expect(res.rpcError || res.isError).toBeTruthy();
  });

  it('rejects an invalid calendar date', async () => {
    const res = await callTool('update_sale', { sale_id: harness.ids.sale, sale_date: '2026-02-30' });
    expect(res.rpcError || res.isError).toBeTruthy();
  });

  it('rejects editing a sale that does not exist', async () => {
    const { isError } = await callTool('update_sale', { sale_id: '99999999-9999-4999-8999-000000000000', price: 1 });
    expect(isError).toBe(true);
  });

  it('is a no-op (no change log rows) when called with only sale_id', async () => {
    await callTool('update_sale', { sale_id: harness.ids.sale });
    const { data: changes } = await callTool('list_changes', { record_id: harness.ids.sale });
    expect(changes).toEqual([]);
  });
});

describe('update_purchase', () => {
  it('edits unit_cost, purchase_date, and notes, logging each change', async () => {
    const { data } = await callTool('update_purchase', {
      purchase_id: harness.ids.inventory, unit_cost: 120, purchase_date: '2026-08-15', notes: 'bought on sale',
    });
    expect(data.unit_cost).toBe(120);
    expect(data.purchase_date).toBe('2026-08-15');
    expect(data.notes).toBe('bought on sale');

    const { data: changes } = await callTool('list_changes', { record_id: harness.ids.inventory });
    expect(changes.map((c) => c.field).sort()).toEqual(['notes', 'purchase_date', 'unit_purchase_cost']);
  });

  it('creates a new vendor automatically when store is new', async () => {
    await callTool('update_purchase', { purchase_id: harness.ids.inventory, store: 'Brand New Store' });
    expect(harness.db.platform.some((p) => p.name === 'Brand New Store' && p.type === 'Vendor')).toBe(true);
  });

  it('rejects lowering qty below what has already sold', async () => {
    // Fixture: qty_purchased=5, qty_on_hand=3 -> 2 already sold.
    const { isError } = await callTool('update_purchase', { purchase_id: harness.ids.inventory, qty: 1 });
    expect(isError).toBe(true);
  });

  it('allows lowering qty down to (but not below) the amount already sold', async () => {
    const { data } = await callTool('update_purchase', { purchase_id: harness.ids.inventory, qty: 2 });
    expect(data.qty).toBe(2);
    expect(data.qty_on_hand).toBe(0);
  });

  it('rejects an unknown field (strict schema)', async () => {
    const res = await callTool('update_purchase', { purchase_id: harness.ids.inventory, total_cost: 999 });
    expect(res.rpcError || res.isError).toBeTruthy();
  });

  it('rejects editing a purchase that does not exist', async () => {
    const { isError } = await callTool('update_purchase', { purchase_id: '99999999-9999-4999-8999-000000000000', unit_cost: 1 });
    expect(isError).toBe(true);
  });
});

describe('add_sale', () => {
  it('logs a new sale against existing inventory and decrements qty_on_hand', async () => {
    const before = harness.db.inventory[0].qty_on_hand;
    const { data } = await callTool('add_sale', {
      inventory_id: harness.ids.inventory, qty: 1, sale_price: 200, fees: 10, sale_date: '2026-09-20', platform: 'QA Marketplace', notes: 'fast sale',
    });
    expect(data.qty).toBe(1);
    expect(data.sale_price).toBe(200);
    expect(data.fees).toBe(10);
    expect(data.notes).toBe('fast sale');
    expect(harness.db.inventory[0].qty_on_hand).toBe(before - 1);
    expect(harness.db.sales.some((s) => s.id === data.id)).toBe(true);
  });

  it('rejects an unknown platform and never creates one', async () => {
    const before = harness.db.platform.length;
    const { isError } = await callTool('add_sale', {
      inventory_id: harness.ids.inventory, qty: 1, sale_price: 200, sale_date: '2026-09-20', platform: 'Totally New Platform',
    });
    expect(isError).toBe(true);
    expect(harness.db.platform).toHaveLength(before);
  });

  it('rejects overselling', async () => {
    const { isError } = await callTool('add_sale', {
      inventory_id: harness.ids.inventory, qty: 999, sale_price: 200, sale_date: '2026-09-20', platform: 'QA Marketplace',
    });
    expect(isError).toBe(true);
  });

  it('rejects a purchase that does not exist', async () => {
    const { isError } = await callTool('add_sale', {
      inventory_id: '99999999-9999-4999-8999-000000000000', qty: 1, sale_price: 200, sale_date: '2026-09-20', platform: 'QA Marketplace',
    });
    expect(isError).toBe(true);
  });
});

describe('list_changes', () => {
  it('returns every change by default and respects an explicit limit', async () => {
    await callTool('update_sale', { sale_id: harness.ids.sale, price: 161 });
    await callTool('update_sale', { sale_id: harness.ids.sale, price: 162 });
    await callTool('update_sale', { sale_id: harness.ids.sale, price: 163 });
    const all = await callTool('list_changes', {});
    expect(all.data).toHaveLength(3);
    const limited = await callTool('list_changes', { limit: 1 });
    expect(limited.data).toHaveLength(1);
  });

  it('filters to one record_id', async () => {
    await callTool('update_sale', { sale_id: harness.ids.sale, price: 161 });
    await callTool('update_purchase', { purchase_id: harness.ids.inventory, unit_cost: 50 });
    const { data } = await callTool('list_changes', { record_id: harness.ids.sale });
    expect(data).toHaveLength(1);
    expect(data[0].table).toBe('Sales');
  });
});
