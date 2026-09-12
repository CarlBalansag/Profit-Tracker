import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());
const write = async (method, path, data) => { const response = await fetch(`${base}/api/sales${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); return { status: response.status, data: await response.json() }; };
describe('sale decimal writes', () => {
  it('writes all sale currency fields and preserves partial edits including historical fractions', async () => {
    const created = await write('POST', '', { inventory_id: harness.ids.inventory, quantity: 2, unit_price: '0.29', commission_fee: '0.01', sale_shipping: '0.02', sale_tax_collected: '0.03' });
    expect(created.status).toBe(200);
    expect(created.data.unit_price_decimal).toBe('0.29');
    expect(created.data.sale_tax_collected_decimal).toBe('0.03');
    const updated = await write('PUT', `/${created.data.id}`, { status: 'PAID' });
    expect(updated.data.unit_price_decimal).toBe('0.29');
    expect(harness.db.inventory[0].qty_on_hand).toBe(1);
    harness.db.sales[0].unit_price = 1.234567;
    const historic = await write('PUT', `/${harness.ids.sale}`, { status: 'PAID' });
    expect(historic.status).toBe(200);
    expect(historic.data.unit_price).toBe(1.23);
    expect(harness.db.sales[0].unit_price).toBe(1.234567);
    expect(historic.data.unit_price_decimal).toBe('1.23');
  });
  it.each(['0.001', -1, 'NaN', '1000000000000'])('rejects invalid %s without claiming stock or changing sales', async value => {
    const original = structuredClone({ inventory: harness.db.inventory, sales: harness.db.sales });
    expect((await write('POST', '', { inventory_id: harness.ids.inventory, unit_price: value })).status).toBe(400);
    expect((await write('PUT', `/${harness.ids.sale}`, { sale_shipping: value })).status).toBe(400);
    expect({ inventory: harness.db.inventory, sales: harness.db.sales }).toEqual(original);
  });
  it('rolls back both currency representations and stock on failure and retries safely', async () => {
    harness.faults['sales.create'] = true;
    expect((await write('POST', '', { inventory_id: harness.ids.inventory, unit_price: '0.29' })).status).toBe(500);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    harness.faults['sales.create'] = false;
    expect((await write('POST', '', { inventory_id: harness.ids.inventory, unit_price: '0.29' })).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(2);
  });
});
