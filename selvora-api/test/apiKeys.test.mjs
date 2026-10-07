import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
// Loaded AFTER harness.cjs, whose top-level monkeypatch already swapped
// require.cache's entry for ../prisma.js -- same technique test/decimalFinance.test.mjs
// etc. rely on via requireApi, just reached here through a second createRequire.
const { createApiKey, rotateApiKey, revokeApiKey, verifyApiKey } = createRequire(import.meta.url)('../services/apiKeys.js');

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
  const response = await fetch(`${baseUrl}/api/api-keys${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

describe('services/apiKeys.js (hash/verify/revoke)', () => {
  it('verifies a freshly created key by its raw token and never stores it in the clear', async () => {
    const { record, token } = await createApiKey(harness.ids.user, 'Claude MCP');
    expect(record.key_hash).not.toBe(token);
    expect(token.length).toBeGreaterThan(40);
    const verified = await verifyApiKey(token);
    expect(verified.id).toBe(record.id);
    expect(verified.user.id).toBe(harness.ids.user);
  });

  it('rejects a token that was never issued', async () => {
    expect(await verifyApiKey('not-a-real-token')).toBeNull();
  });

  it('rejects a revoked key even with the correct raw token', async () => {
    const { record, token } = await createApiKey(harness.ids.user, 'Claude MCP');
    await revokeApiKey(harness.ids.user, record.id);
    expect(await verifyApiKey(token)).toBeNull();
  });

  it('rotating invalidates the old token and issues a working new one', async () => {
    const first = await createApiKey(harness.ids.user, 'Claude MCP');
    const rotated = await rotateApiKey(harness.ids.user, first.record.id);
    expect(await verifyApiKey(first.token)).toBeNull();
    expect((await verifyApiKey(rotated.token)).id).toBe(rotated.record.id);
  });

  it('refuses to rotate a key owned by another user', async () => {
    const { record } = await createApiKey(harness.ids.other, 'Someone else\'s key');
    await expect(rotateApiKey(harness.ids.user, record.id)).rejects.toThrow();
  });
});

describe('api-keys route (Settings page backend)', () => {
  it('creates a key and returns the raw token exactly once', async () => {
    const created = await call('POST', '', { name: 'Claude MCP' });
    expect(created.status).toBe(200);
    expect(typeof created.body.token).toBe('string');
    expect(created.body.key_hash).toBeUndefined();

    const list = await call('GET', '');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].token).toBeUndefined();
    expect(list.body[0].key_hash).toBeUndefined();
    expect(list.body[0].key_prefix).toBe(created.body.key_prefix);
  });

  it('rotating returns a new token and marks the key revoked_at only after rotation', async () => {
    const created = await call('POST', '', { name: 'Claude MCP' });
    const rotated = await call('POST', `/${created.body.id}/rotate`, {});
    expect(rotated.status).toBe(200);
    expect(rotated.body.id).not.toBe(created.body.id);
    expect(rotated.body.token).not.toBe(created.body.token);

    const list = await call('GET', '');
    const old = list.body.find(k => k.id === created.body.id);
    expect(old.revoked_at).not.toBeNull();
  });

  it('deleting (revoking) a key does not erase it', async () => {
    const created = await call('POST', '', { name: 'Claude MCP' });
    const revoked = await call('DELETE', `/${created.body.id}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked_at).not.toBeNull();
    const list = await call('GET', '');
    expect(list.body.some(k => k.id === created.body.id)).toBe(true);
  });
});
