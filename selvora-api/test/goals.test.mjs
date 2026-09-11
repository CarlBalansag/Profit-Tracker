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

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('goal validation', () => {
  it('rejects negative, non-finite, and unsupported goal values before a write', async () => {
    const negative = await request('POST', '/api/goals', { metric: 'netProfit', target_7d: -1 });
    const invalid = await request('POST', '/api/goals', { metric: 'unitsSold', target_30d: 'not-a-number' });
    const metric = await request('POST', '/api/goals', { metric: 'margin', target_ytd: 10 });

    expect(negative.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(metric.status).toBe(400);
    expect(harness.db.goal).toHaveLength(0);
  });

  it('converts string boolean values intentionally on create and update', async () => {
    const created = await request('POST', '/api/goals', { metric: 'netProfit', target_30d: '500', active: 'false' });
    const updated = await request('PUT', `/api/goals/${created.body.id}`, { active: 'true', target_7d: '' });

    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ target_30d: 500, active: false });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ target_7d: null, target_30d: 500, active: true });
  });
});
