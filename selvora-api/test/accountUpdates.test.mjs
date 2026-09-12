import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
let server;
let baseUrl;
const accountId = '99999999-9999-4999-8999-999999999999';
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  harness.reset();
  harness.db.account.push({ id: accountId, user_id: harness.ids.user,
    platform_id: harness.ids.vendor, name: 'Vendor account', status: 'Active',
    email: 'old@example.com', username: 'old-user', notes: 'Old notes' });
});
const request = async (method, path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}/api/accounts${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};
const update = body => request('PUT', `/${accountId}`, body);

describe('account optional field updates', () => {
  it.each(['email', 'username', 'notes'])('clears %s with an empty string, persists on read and supports repeated clearing', async field => {
    expect((await update({ [field]: '' })).status).toBe(200);
    expect(harness.db.account[0][field]).toBeNull();
    expect((await request('GET', '')).body[0][field]).toBeNull();
    expect((await update({ [field]: '' })).body[field]).toBeNull();
    for (const other of ['email', 'username', 'notes'].filter(key => key !== field)) {
      expect(harness.db.account[0][other]).not.toBeNull();
    }
  });
  it('clears all optional fields with null without changing ownership or platform', async () => {
    const response = await update({ email: null, username: null, notes: null });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ email: null, username: null, notes: null,
      user_id: harness.ids.user, platform_id: harness.ids.vendor });
  });
  it('preserves omitted fields on a partial update and an empty update', async () => {
    const original = structuredClone(harness.db.account[0]);
    expect((await update({ name: 'Renamed' })).body).toMatchObject({ ...original, name: 'Renamed' });
    expect((await update({})).body).toMatchObject({ ...original, name: 'Renamed' });
  });
  it('sets new optional values and supports clearing then restoring', async () => {
    await update({ email: '' });
    expect((await update({ email: 'new@example.com', username: 'new-user', notes: 'New notes' })).body)
      .toMatchObject({ email: 'new@example.com', username: 'new-user', notes: 'New notes' });
  });
  it.each([{ name: '' }, { name: null }, { notes: 123 }, { email: 'x'.repeat(1001) }])('rejects invalid input without modifying records: %j', async body => {
    const original = structuredClone(harness.db.account);
    expect((await update(body)).status).toBe(400);
    expect(harness.db.account).toEqual(original);
  });
  it('rejects missing, foreign and unauthenticated records before writes', async () => {
    expect((await request('PUT', `/${harness.ids.foreign}`, { email: '' })).status).toBe(404);
    harness.db.account[0].user_id = harness.ids.foreign;
    expect((await update({ email: '' })).status).toBe(404);
    expect((await request('PUT', `/${accountId}`, { email: '' }, { 'x-qa-unauthenticated': 'true' })).status).toBe(401);
    expect(harness.db.account[0].email).toBe('old@example.com');
  });
  it('preserves data on database failure and allows retry', async () => {
    const original = structuredClone(harness.db.account);
    harness.faults['account.update'] = true;
    expect((await update({ email: '' })).status).toBe(500);
    expect(harness.db.account).toEqual(original);
    delete harness.faults['account.update'];
    expect((await update({ email: '' })).body.email).toBeNull();
  });
  it('keeps create and delete flows working with empty optional fields', async () => {
    const created = await request('POST', '', { platform_id: harness.ids.vendor, name: 'New account', email: '', username: '', notes: '' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ email: null, username: null, notes: null });
    expect((await request('DELETE', `/${created.body.id}`)).status).toBe(204);
    expect(harness.db.account).toHaveLength(1);
  });
});
