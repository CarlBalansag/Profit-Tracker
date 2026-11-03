import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());

const request = async (method, path, body) => {
  const response = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
};
const inv = () => harness.db.inventory[0];
const iso = (value) => (value ? new Date(value).toISOString().slice(0, 10) : value);

describe('purchase return window (return_by_date)', () => {
  it('is optional on create and stored as the given calendar date', async () => {
    let res = await request('POST', 'inventory', { product_name: 'With window', unit_purchase_cost: 10, qty_purchased: 1, purchase_date: '2026-11-02', return_by_date: '2027-01-31' });
    expect(res.status).toBe(200);
    expect(iso(harness.db.inventory.find(i => i.id === res.body.id).return_by_date)).toBe('2027-01-31');

    res = await request('POST', 'inventory', { product_name: 'No window', unit_purchase_cost: 10, qty_purchased: 1 });
    expect(res.status).toBe(200);
    expect(harness.db.inventory.find(i => i.id === res.body.id).return_by_date).toBe(null);
  });

  it('rejects an invalid date without creating anything', async () => {
    const count = harness.db.inventory.length;
    const res = await request('POST', 'inventory', { product_name: 'Bad', unit_purchase_cost: 10, qty_purchased: 1, return_by_date: 'next tuesday' });
    expect(res.status).toBe(400);
    expect(harness.db.inventory.length).toBe(count);
  });

  it('PUT sets it, keeps it on unrelated edits, and clears it with an empty value', async () => {
    expect((await request('PUT', `inventory/${harness.ids.inventory}`, { return_by_date: '2026-12-01' })).status).toBe(200);
    expect(iso(inv().return_by_date)).toBe('2026-12-01');

    expect((await request('PUT', `inventory/${harness.ids.inventory}`, { tracking_number: 'QA-2' })).status).toBe(200);
    expect(iso(inv().return_by_date)).toBe('2026-12-01');

    expect((await request('PUT', `inventory/${harness.ids.inventory}`, { return_by_date: '' })).status).toBe(200);
    expect(inv().return_by_date).toBe(null);
  });

  it('the transaction edit window can set, keep and clear it atomically', async () => {
    const path = `inventory/${harness.ids.inventory}/transaction`;
    expect((await request('PUT', path, { inventory: { return_by_date: '2026-12-15' }, sales: [] })).status).toBe(200);
    expect(iso(inv().return_by_date)).toBe('2026-12-15');
    expect((await request('PUT', path, { inventory: { product_name: 'Renamed' }, sales: [] })).status).toBe(200);
    expect(iso(inv().return_by_date)).toBe('2026-12-15');
    expect((await request('PUT', path, { inventory: { return_by_date: null }, sales: [] })).status).toBe(200);
    expect(inv().return_by_date).toBe(null);
  });

  it('is returned by the inventory list and single-item reads', async () => {
    inv().return_by_date = new Date('2026-12-01T12:00:00Z');
    const list = (await request('GET', 'inventory')).body;
    expect(iso(list.find(i => i.id === harness.ids.inventory).return_by_date)).toBe('2026-12-01');
    const one = (await request('GET', `inventory/${harness.ids.inventory}`)).body;
    expect(iso(one.return_by_date)).toBe('2026-12-01');
  });

  it('never changes any money total', async () => {
    const before = (await request('GET', 'analytics/dashboard?mode=All&date=All%20Time')).body.stats;
    await request('PUT', `inventory/${harness.ids.inventory}`, { return_by_date: '2026-09-02' });
    expect((await request('GET', 'analytics/dashboard?mode=All&date=All%20Time')).body.stats).toEqual(before);
  });
});
