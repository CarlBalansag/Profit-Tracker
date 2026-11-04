import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());

const save = async (body) => {
  const response = await fetch(`${base}/api/inventory/${ids.inventory}/transaction`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const inv = () => harness.db.inventory[0];
const sale = () => harness.db.sales[0];

describe('transaction edit window: fields from Add Transaction', () => {
  it('saves and clears the order number', async () => {
    expect((await save({ inventory: { order_number: 'ORD-1' }, sales: [] })).status).toBe(200);
    expect(inv().order_number).toBe('ORD-1');
    expect((await save({ inventory: { order_number: null }, sales: [] })).status).toBe(200);
    expect(inv().order_number).toBe(null);
  });

  it('saves the buyer tax fields on a sale, and keeps them when not sent', async () => {
    expect((await save({ inventory: {}, sales: [{ id: ids.sale, customer_tax_exempt: true, exemption_type: 'Resale' }] })).status).toBe(200);
    expect(sale()).toMatchObject({ customer_tax_exempt: true, exemption_type: 'Resale' });
    expect((await save({ inventory: {}, sales: [{ id: ids.sale, unit_price: 151 }] })).status).toBe(200);
    expect(sale()).toMatchObject({ customer_tax_exempt: true, exemption_type: 'Resale', unit_price: 151 });
  });
});

describe('transaction edit window: tracking follows the same rules as everywhere else', () => {
  beforeEach(() => Object.assign(inv(), { tracking_number: null, status: 'PURCHASED', receiving_status: 'PURCHASED', is_listed: false }));

  it('a first tracking number moves the purchase along', async () => {
    expect((await save({ inventory: { status: 'PURCHASED', tracking_number: '1Z999AA10123456784' }, sales: [] })).status).toBe(200);
    expect(inv().tracking_number).toBe('1Z999AA10123456784');
    expect(inv().status).toBe('SHIPPED_IN');
    expect(inv().receiving_status).toBe('INBOUND');
    expect(inv().receiving_status_changed_at).toBeTruthy();
  });

  it('does not override a status picked in the same save', async () => {
    expect((await save({ inventory: { status: 'DELIVERED', tracking_number: '1Z999AA10123456784' }, sales: [] })).status).toBe(200);
    expect(inv().status).toBe('DELIVERED');
  });

  it('refuses a first tracking number once the purchase has arrived, saving nothing', async () => {
    inv().receiving_status = 'ON_HAND';
    const res = await save({ inventory: { product_name: 'Renamed', tracking_number: '1Z999AA10123456784' }, sales: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been received/);
    expect(inv()).toMatchObject({ tracking_number: null, product_name: 'QA Multi-unit Sneaker' });
  });

  it('still lets an existing number be corrected or cleared after arrival, without moving the status', async () => {
    Object.assign(inv(), { tracking_number: 'OLD', receiving_status: 'ON_HAND', status: 'On Hand' });
    expect((await save({ inventory: { status: 'On Hand', tracking_number: 'NEW' }, sales: [] })).status).toBe(200);
    expect(inv()).toMatchObject({ tracking_number: 'NEW', receiving_status: 'ON_HAND', status: 'On Hand' });
    expect((await save({ inventory: { status: 'On Hand', tracking_number: null }, sales: [] })).status).toBe(200);
    expect(inv().tracking_number).toBe(null);
  });

  it('leaves everything alone when no tracking is sent', async () => {
    expect((await save({ inventory: { status: 'PURCHASED' }, sales: [] })).status).toBe(200);
    expect(inv()).toMatchObject({ tracking_number: null, status: 'PURCHASED', receiving_status: 'PURCHASED' });
  });
});
