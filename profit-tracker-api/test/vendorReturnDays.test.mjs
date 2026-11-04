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
const vendor = () => harness.db.platform.find(p => p.id === harness.ids.vendor);

describe('vendor default return days', () => {
  it('is optional on create', async () => {
    let res = await request('POST', 'platforms', { name: 'Home Depot', type: 'Vendor', default_return_days: 90 });
    expect(res.status).toBe(200);
    expect(res.body.default_return_days).toBe(90);

    res = await request('POST', 'platforms', { name: 'No policy', type: 'Vendor', default_return_days: '' });
    expect(res.status).toBe(200);
    expect(res.body.default_return_days).toBe(null);
  });

  it('PUT sets it, keeps it on unrelated edits, and clears it with an empty value', async () => {
    const path = `platforms/${harness.ids.vendor}`;
    expect((await request('PUT', path, { default_return_days: '30' })).status).toBe(200);
    expect(vendor().default_return_days).toBe(30);

    expect((await request('PUT', path, { notes: 'edited' })).status).toBe(200);
    expect(vendor().default_return_days).toBe(30);

    expect((await request('PUT', path, { default_return_days: '' })).status).toBe(200);
    expect(vendor().default_return_days).toBe(null);
  });

  it.each([[-1], [1.5], [3651], ['abc']])('rejects %s without changing anything', async (value) => {
    expect((await request('PUT', `platforms/${harness.ids.vendor}`, { default_return_days: 45 })).status).toBe(200);
    const res = await request('PUT', `platforms/${harness.ids.vendor}`, { default_return_days: value });
    expect(res.status).toBe(400);
    expect(vendor().default_return_days).toBe(45);
  });
});
