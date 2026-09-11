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

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('related record ownership', () => {
  it('rejects a foreign vendor or payment method on inventory create and update', async () => {
    const create = await request('POST', '/api/inventory', {
      product_name: 'Foreign relationship', vendor_id: harness.ids.foreign,
    });
    const update = await request('PUT', `/api/inventory/${harness.ids.inventory}`, {
      vendor_id: harness.ids.foreign,
    });
    expect(create.status).toBe(404);
    expect(update.status).toBe(404);
    expect(harness.db.inventory).toHaveLength(1);
    expect(harness.db.inventory[0].vendor_id).toBe(harness.ids.vendor);
  });

  it('rejects a foreign platform for sales and accounts', async () => {
    const sale = await request('POST', '/api/sales', {
      inventory_id: harness.ids.inventory, platform_id: harness.ids.foreign, unit_price: 100,
    });
    const account = await request('POST', '/api/accounts', {
      platform_id: harness.ids.foreign, name: 'Foreign account',
    });
    expect(sale.status).toBe(404);
    expect(account.status).toBe(404);
    expect(harness.db.sales).toHaveLength(1);
    expect(harness.db.account).toHaveLength(0);
  });

  it('rejects a foreign ID in the platform batch route', async () => {
    const response = await request('POST', '/api/platforms/batch', {
      vendors: [{ id: harness.ids.foreign, name: 'Foreign platform' }],
    });
    expect(response.status).toBe(404);
    expect(harness.db.platform.find((platform) => platform.id === harness.ids.foreign).user_id).toBe(harness.ids.other);
  });
});
