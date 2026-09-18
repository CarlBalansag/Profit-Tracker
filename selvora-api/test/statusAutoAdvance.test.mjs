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

const put = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('inbound status auto-advance', () => {
  it('advances PURCHASED to SHIPPED_IN when a tracking number is first added', async () => {
    const created = await harness.prisma.inventory.create({
      data: { user_id: harness.ids.user, product_name: 'Fresh inbound', vendor_id: harness.ids.vendor, unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED' },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: '1Z999AA10123456784' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_IN');
  });

  it('does not advance a status that is already further along', async () => {
    const created = await harness.prisma.inventory.create({
      data: { user_id: harness.ids.user, product_name: 'Already completed', vendor_id: harness.ids.vendor, unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'COMPLETED' },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: '1Z999AA10123456784' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('respects an explicit status change in the same request instead of auto-advancing', async () => {
    const created = await harness.prisma.inventory.create({
      data: { user_id: harness.ids.user, product_name: 'Explicit status', vendor_id: harness.ids.vendor, unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED' },
    });
    const res = await put(`/api/inventory/${created.id}`, { tracking_number: '1Z999AA10123456784', status: 'CANCELLED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('does not re-advance when a tracking number is merely edited, not newly added', async () => {
    // The default fixture item already has a tracking_number and stays PURCHASED.
    const res = await put(`/api/inventory/${harness.ids.inventory}`, { tracking_number: '1Z999AA10123456784' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PURCHASED');
  });

  it('advances a brand-new item created with a tracking number already set', async () => {
    const res = await post('/api/inventory', {
      product_name: 'Created with tracking', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 1, tracking_number: '1Z999AA10123456784',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_IN');
  });

  it('respects an explicit status at creation instead of auto-advancing', async () => {
    const res = await post('/api/inventory', {
      product_name: 'Explicit at creation', vendor_id: harness.ids.vendor,
      unit_purchase_cost: 10, qty_purchased: 1, tracking_number: '1Z999AA10123456784', status: 'Pre Order',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Pre Order');
  });
});

describe('outbound status auto-advance', () => {
  it('advances SOLD to SHIPPED_OUT when a tracking number is first added', async () => {
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: '999999999999' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_OUT');
  });

  it('does not advance a sale status that is already further along', async () => {
    harness.db.sales.find(s => s.id === harness.ids.sale).status = 'PAID';
    const res = await put(`/api/sales/${harness.ids.sale}`, { tracking_number: '999999999999' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PAID');
  });

  it('advances a brand-new sale created with a tracking number already set', async () => {
    const res = await post('/api/sales', {
      inventory_id: harness.ids.inventory, platform_id: harness.ids.platform,
      quantity: 1, unit_price: 50, tracking_number: '999999999999',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED_OUT');
  });
});
