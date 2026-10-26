import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => harness.reset());
afterAll(() => server.close());

const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const put = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('currency migration Task 5: sales flow decimal validation', () => {
  it('accepts a valid 2-decimal sale on create', async () => {
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory,
      quantity: 1,
      unit_price: '64.20',
      commission_fee: '13.33',
      sale_shipping: '10.04',
    });
    expect(res.status).toBe(200);
    expect(res.body.unit_price).toBe(64.2);
    expect(res.body.commission_fee).toBe(13.33);
  });

  it('rejects an over-precision unit_price on create', async () => {
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory,
      quantity: 1,
      unit_price: '64.209',
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed and non-finite sale money input on create', async () => {
    for (const field of ['unit_price', 'commission_fee', 'sale_shipping', 'sale_tax_collected']) {
      const res = await post('/api/sales', {
        inventory_id: harness.ids.inventory,
        quantity: 1,
        unit_price: '50.00',
        [field]: 'Infinity',
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects an over-precision unit_price on update and leaves the stored value unchanged', async () => {
    const res = await put(`/api/sales/${harness.ids.sale}`, { unit_price: '150.009' });
    expect(res.status).toBe(400);
    expect(harness.db.sales[0].unit_price).toBe(150);
  });

  it('rejects a negative commission_fee on update', async () => {
    const res = await put(`/api/sales/${harness.ids.sale}`, { commission_fee: '-1.00' });
    expect(res.status).toBe(400);
    expect(harness.db.sales[0].commission_fee).toBe(15);
  });

  it('validates the inline sale fields on POST /api/inventory the same way, closing the previously-unvalidated sale_shipping/sale_tax_collected gap', async () => {
    const res = await post('/api/inventory', {
      product_name: 'QA Immediate Sale',
      vendor_id: harness.ids.vendor,
      qty_purchased: 1,
      unit_purchase_cost: '10.00',
      sale_price: '25.00',
      sale_shipping: '3.999', // over-precision -- previously passed straight through unchecked
      qty_sold: 1,
    });
    expect(res.status).toBe(400);
  });

  it('still accepts a valid inline sale on POST /api/inventory with all four sale fields validated', async () => {
    const res = await post('/api/inventory', {
      product_name: 'QA Immediate Sale',
      vendor_id: harness.ids.vendor,
      qty_purchased: 1,
      unit_purchase_cost: '10.00',
      sale_price: '25.00',
      commission_fee: '2.50',
      sale_shipping: '4.00',
      sale_tax_collected: '1.75',
      qty_sold: 1,
    });
    expect(res.status).toBe(200);
  });
});
