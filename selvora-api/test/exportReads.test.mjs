import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server, base;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());
describe('read-only exports', () => {
  it('reads all export sources with ownership filters and never generates expense occurrences', async () => {
    for (const route of ['platforms', 'accounts', 'payment-methods', 'inventory', 'expenses', 'recurring-expenses?export=true']) {
      const result = await fetch(`${base}/api/${route}`);
      expect(result.status).toBe(200);
      expect(Array.isArray(await result.json())).toBe(true);
    }
    expect(harness.calls.filter(call => ['create', 'createMany', 'update', 'updateMany', 'delete'].includes(call.op))).toEqual([]);
    for (const call of harness.calls.filter(call => call.op === 'findMany')) {
      expect(call.args.where.user_id).toBe(harness.ids.user);
    }
  });
  it('rejects export reads without authentication', async () => {
    expect((await fetch(`${base}/api/recurring-expenses?export=true`, { headers: { 'x-qa-unauthenticated': 'true' } })).status).toBe(401);
    expect(harness.calls).toHaveLength(0);
  });
});
