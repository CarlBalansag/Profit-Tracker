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

const call = async (method, path, body) => {
  const response = await fetch(`${baseUrl}/api/buyers${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

describe('buyers route', () => {
  it('creates a buyer owned by the current user', async () => {
    const created = await call('POST', '', { name: 'Windy City' });
    expect(created.status).toBe(200);
    expect(created.body.name).toBe('Windy City');
    expect(created.body.user_id).toBe(harness.ids.user);
  });

  it('rejects a buyer with no name', async () => {
    const created = await call('POST', '', {});
    expect(created.status).toBe(400);
  });

  it('lists only the current user\'s buyers', async () => {
    harness.db.buyer.push(
      { id: 'owned', user_id: harness.ids.user, name: 'Blake' },
      { id: 'foreign', user_id: harness.ids.other, name: 'Someone else\'s buyer' },
    );
    const list = await call('GET', '');
    expect(list.status).toBe(200);
    expect(list.body.map(b => b.name)).toEqual(['Blake']);
  });

  it('updates an owned buyer', async () => {
    harness.db.buyer.push({ id: 'owned', user_id: harness.ids.user, name: 'Tradepost', avg_days_to_payout: 3 });
    const updated = await call('PUT', '/owned', { avg_days_to_payout: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.avg_days_to_payout).toBe(5);
    expect(updated.body.name).toBe('Tradepost');
  });

  it('refuses to update a buyer owned by another user', async () => {
    harness.db.buyer.push({ id: 'foreign', user_id: harness.ids.other, name: 'Not yours' });
    const updated = await call('PUT', '/foreign', { name: 'Hijacked' });
    expect(updated.status).toBe(404);
    expect(harness.db.buyer.find(b => b.id === 'foreign').name).toBe('Not yours');
  });

  it('refuses to delete a buyer owned by another user', async () => {
    harness.db.buyer.push({ id: 'foreign', user_id: harness.ids.other, name: 'Not yours' });
    const deleted = await call('DELETE', '/foreign');
    expect(deleted.status).toBe(404);
    expect(harness.db.buyer.some(b => b.id === 'foreign')).toBe(true);
  });

  it('deletes an owned buyer', async () => {
    harness.db.buyer.push({ id: 'owned', user_id: harness.ids.user, name: 'EarnFromBuying' });
    const deleted = await call('DELETE', '/owned');
    expect(deleted.status).toBe(200);
    expect(harness.db.buyer.some(b => b.id === 'owned')).toBe(false);
  });
});
