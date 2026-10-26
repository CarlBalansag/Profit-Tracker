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

const update = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('partial API updates', () => {
  it('does not overwrite inventory money or quantity when changing only tracking', async () => {
    const response = await update(`/api/inventory/${harness.ids.inventory}`, { tracking_number: 'QA-new-tracking' });

    expect(response.status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({
      tracking_number: 'QA-new-tracking',
      unit_purchase_cost: 100,
      qty_purchased: 5,
      sales_tax: 40,
      shipping_cost_inbound: 20,
      fees: 10,
      gift_card_amount: 50,
    });
  });

  it('does not overwrite sale money or quantity when changing only status', async () => {
    const response = await update(`/api/sales/${harness.ids.sale}`, { status: 'PAID' });

    expect(response.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({
      status: 'PAID',
      quantity: 2,
      commission_fee: 15,
      sale_shipping: 12,
      sale_tax_collected: 8,
    });
  });
});
