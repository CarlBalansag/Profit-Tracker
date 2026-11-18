// Buying more of an item already committed: the parts that go through the web
// routes and the AI assistant (the commit logic itself is covered against real
// Postgres in cashoutRecommitPostgres.test.mjs).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const ebAdapter = require('../services/cashouts/eb');
const commits = require('../services/cashouts/commits');
const { ids } = harness;

let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const SALE_B = '44444444-4444-4444-8444-4444444444bb';
beforeEach(() => {
  harness.reset();
  vi.restoreAllMocks();
  commits._resetWriteLimits();
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const { db } = harness;
  db.cashoutConnection.push({
    id: 'conn-1', user_id: ids.user, provider: 'eb', display_name: 'EB Primary', encrypted_key: encryptKey('live_test_key_1234'),
    key_last4: '1234', status: 'active', platform_id: ids.platform, created_at: new Date(), updated_at: new Date(),
  });
  // Two purchases on one EB commitment: the fixture sale (2) and another (3).
  Object.assign(db.inventory[0], { receiving_status: 'ON_HAND', qty_purchased: 5, qty_on_hand: 0 });
  Object.assign(db.sales[0], { workflow_status: 'PAID', workflow_type: 'STANDARD_MARKETPLACE', status: 'PAID', restored_qty: 0 });
  db.sales.push({ ...db.sales[0], id: SALE_B, quantity: 3 });
  const row = (id, saleId, quantity, created) => ({
    id, user_id: ids.user, connection_id: 'conn-1', sale_id: saleId, external_deal_id: '2000', external_item_id: '101',
    open_item_id: '101', external_commitment_id: 'eb-1', quantity, status: 'active', tracking_codes: [], commit_error: null,
    created_at: new Date(created), updated_at: new Date(created),
  });
  db.cashoutCommitment.push(row('cm-a', ids.sale, 2, '2026-11-18T10:00:00Z'), row('cm-b', SALE_B, 3, '2026-11-18T11:00:00Z'));
});

const send = async (method, path, body, headers = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
let rpc = 1;
const callTool = async (name, args = {}) => {
  const { body } = await send('POST', '/mcp', { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } });
  const text = body.result?.content?.[0]?.text;
  return { isError: Boolean(body.result?.isError), data: text && !body.result?.isError ? JSON.parse(text) : text };
};

describe('cancelling a committed sale', () => {
  it('offers to lower the commitment by that sale, without sending anything', async () => {
    const update = vi.spyOn(ebAdapter, 'updateCommit');
    const res = await send('POST', `/api/sales/${SALE_B}/actions/cancel_sale`, {});
    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_lower).toEqual({ commitment_id: 'cm-b', cashout: 'EB Primary', quantity: 3, total: 5, remaining: 2 });
    expect(update).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment.find((c) => c.id === 'cm-b').status).toBe('active');
  });

  it('confirming lowers it to what the other purchases still need', async () => {
    const update = vi.spyOn(ebAdapter, 'updateCommit').mockResolvedValue({ id: 'eb-1', quantity: 2 });
    const remove = vi.spyOn(ebAdapter, 'deleteCommit');
    const res = await send('DELETE', '/api/cashouts/commitments/cm-b');
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.anything(), 'eb-1', { quantity: 2 });
    expect(remove).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment.map((c) => [c.id, c.status])).toEqual([['cm-a', 'active'], ['cm-b', 'withdrawn']]);
  });

  it('?all=true withdraws the whole commitment in one call', async () => {
    const update = vi.spyOn(ebAdapter, 'updateCommit');
    const remove = vi.spyOn(ebAdapter, 'deleteCommit').mockResolvedValue(null);
    const res = await send('DELETE', '/api/cashouts/commitments/cm-a?all=true');
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment.every((c) => c.status === 'withdrawn' && c.open_item_id === null)).toBe(true);
  });

  it('a sale with no commitment gets no offer', async () => {
    harness.db.cashoutCommitment.length = 0;
    const res = await send('POST', `/api/sales/${SALE_B}/actions/cancel_sale`, {});
    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_lower).toBeUndefined();
  });
});

describe('AI assistant', () => {
  it('list_cashout_commitments shows each purchase and the shared total', async () => {
    harness.db.cashoutCommitment[1].commit_error = null;
    const { data } = await callTool('list_cashout_commitments');
    expect(data.map((c) => [c.id, c.quantity, c.commitment_total])).toEqual(expect.arrayContaining([['cm-a', 2, 5], ['cm-b', 3, 5]]));
  });

  it('delete_cashout_commitment lowers by default and withdraws everything with all', async () => {
    harness.db.apiKey.push({ id: 'qa-api-key', user_id: ids.user, allow_cashout_writes: true });
    vi.spyOn(ebAdapter, 'updateCommit').mockResolvedValue({ id: 'eb-1', quantity: 3 });
    const remove = vi.spyOn(ebAdapter, 'deleteCommit').mockResolvedValue(null);
    const lowered = await callTool('delete_cashout_commitment', { commitment_id: 'cm-a' });
    expect(lowered.isError).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    const all = await callTool('delete_cashout_commitment', { commitment_id: 'cm-b', all: true });
    expect(all.isError).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
