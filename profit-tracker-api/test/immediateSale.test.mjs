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

const create = async (body) => {
  const response = await fetch(`${baseUrl}/api/inventory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

describe('immediate sale inventory creation', () => {
  it('rejects overselling before creating inventory or a sale', async () => {
    const response = await create({ product_name: 'Oversold', qty_purchased: 1, sale_price: 100, qty_sold: 2 });
    expect(response.status).toBe(400);
    expect(harness.db.inventory).toHaveLength(1);
    expect(harness.db.sales).toHaveLength(1);
  });

  it('rolls back inventory when the immediate sale write fails', async () => {
    harness.faults['sales.create'] = true;
    const response = await create({ product_name: 'Rollback', qty_purchased: 1, sale_price: 100, qty_sold: 1 });
    expect(response.status).toBe(500);
    expect(harness.db.inventory).toHaveLength(1);
  });

  it('preserves the selected purchase status', async () => {
    const response = await create({ product_name: 'Preorder', status: 'Pre Order' });
    expect(response.status).toBe(200);
    expect(harness.db.inventory.at(-1).status).toBe('Pre Order');
  });
});
