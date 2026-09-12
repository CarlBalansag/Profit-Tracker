import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());
const write = async (method, path, data) => {
  const result = await fetch(`${base}/api/inventory${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { status: result.status, data: await result.json() };
};
describe('purchase decimal writes', () => {
  it('dual-writes cents for all purchase fields, preserves omitted values and accepts zero', async () => {
    const created = await write('POST', '', { product_name: 'Decimal item', unit_purchase_cost: '0.29', qty_purchased: 3, sales_tax: '0.10', shipping_cost_inbound: '0.20', fees: '0.01', gift_card_amount: '0.05' });
    expect(created.status).toBe(200);
    expect(created.data.unit_purchase_cost_decimal).toBe('0.29');
    expect(created.data.sales_tax_decimal).toBe('0.10');
    const edited = await write('PUT', `/${created.data.id}`, { fees: 0 });
    expect(edited.data.fees_decimal).toBe('0.00');
    expect(edited.data.unit_purchase_cost_decimal).toBe('0.29');
    expect(edited.data.qty_on_hand).toBe(3);
  });
  it.each(['0.001', -0.01, 'Infinity', true, '1000000000000'])('rejects invalid purchase %s before writing anything', async value => {
    const original = structuredClone(harness.db.inventory);
    expect((await write('POST', '', { product_name: 'Invalid', unit_purchase_cost: value })).status).toBe(400);
    expect((await write('PUT', `/${harness.ids.inventory}`, { sales_tax: value })).status).toBe(400);
    expect(harness.db.inventory).toEqual(original);
  });
  it('does not update either representation after an injected failure and allows retry', async () => {
    harness.faults['inventory.update'] = true;
    expect((await write('PUT', `/${harness.ids.inventory}`, { fees: '0.29' })).status).toBe(500);
    expect(harness.db.inventory[0].fees).toBe(10);
    harness.faults['inventory.update'] = false;
    const result = await write('PUT', `/${harness.ids.inventory}`, { fees: '0.29' });
    expect(result.data.fees_decimal).toBe('0.29');
    expect((await write('PUT', `/${harness.ids.foreign}`, { fees: '0.30' })).status).toBe(404);
  });
});
