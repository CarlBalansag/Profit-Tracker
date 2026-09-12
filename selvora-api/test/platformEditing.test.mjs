import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());
const update = async (id, body, headers = {}) => {
  const response = await fetch(`${baseUrl}/api/platforms/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
describe('platform edit API', () => {
  it('renames the vendor without changing purchase or account associations', async () => {
    harness.db.account.push({ id: 'account', user_id: harness.ids.user, platform_id: harness.ids.vendor });
    const inventory = structuredClone(harness.db.inventory);
    const response = await update(harness.ids.vendor, { name: 'Renamed vendor', address: '', notes: '' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: harness.ids.vendor, name: 'Renamed vendor', type: 'Vendor', address: null, notes: null });
    expect(harness.db.inventory).toEqual(inventory);
    expect(harness.db.account[0].platform_id).toBe(harness.ids.vendor);
  });
  it('updates marketplace suggestions without rewriting historical sale commissions or tax settings', async () => {
    const sales = structuredClone(harness.db.sales);
    expect((await update(harness.ids.platform, { name: 'Renamed market', fee_pct: 7.5 })).status).toBe(200);
    expect(harness.db.sales).toEqual(sales);
    expect(harness.db.platform.find(record => record.id === harness.ids.platform).fee_pct).toBe(7.5);
  });
  it('preserves omitted fields on empty and partial repeated updates', async () => {
    const original = structuredClone(harness.db.platform[0]);
    expect((await update(harness.ids.vendor, {})).body).toMatchObject(original);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await update(harness.ids.vendor, { notes: 'New notes' })).body).toMatchObject({ ...original, notes: 'New notes' });
    }
  });
  it.each([{ name: '' }, { fee_pct: -1 }, { fee_pct: 'invalid' }, { notes: 23 }])('rejects invalid values without writes %j', async body => {
    const original = structuredClone(harness.db.platform);
    expect((await update(harness.ids.platform, body)).status).toBe(400);
    expect(harness.db.platform).toEqual(original);
  });
  it('rejects foreign, missing and unauthenticated records', async () => {
    const original = structuredClone(harness.db.platform);
    expect((await update(harness.ids.foreign, { name: 'Forbidden' })).status).toBe(404);
    expect((await update(harness.ids.inventory, { name: 'Missing' })).status).toBe(404);
    expect((await update(harness.ids.vendor, { name: 'Forbidden' }, { 'x-qa-unauthenticated': 'true' })).status).toBe(401);
    expect(harness.db.platform).toEqual(original);
  });
  it('preserves records on database failure and supports retry', async () => {
    const original = structuredClone(harness.db.platform);
    harness.faults['platform.update'] = true;
    expect((await update(harness.ids.vendor, { name: 'Retry' })).status).toBe(500);
    expect(harness.db.platform).toEqual(original);
    delete harness.faults['platform.update'];
    expect((await update(harness.ids.vendor, { name: 'Retry' })).status).toBe(200);
  });
});
