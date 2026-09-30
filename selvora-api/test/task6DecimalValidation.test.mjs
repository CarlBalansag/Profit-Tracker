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

const call = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};
const post = (path, body) => call('POST', path, body);
const put = (path, body) => call('PUT', path, body);

describe('currency migration Task 6: expenses, recurring expenses, payment methods, platforms, goals', () => {
  it('rejects an over-precision expense amount on create', async () => {
    const res = await post('/api/expenses', { name: 'QA', amount: '12.999', date: '2026-09-01' });
    expect(res.status).toBe(400);
  });

  it('accepts a valid 2-decimal expense amount', async () => {
    const res = await post('/api/expenses', { name: 'QA', amount: '12.99', date: '2026-09-01' });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(12.99);
  });

  it('rejects an over-precision recurring expense amount on create', async () => {
    const res = await post('/api/recurring-expenses', {
      name: 'Rent', amount: '999.995', frequency: 'monthly', start_date: '2026-09-01',
    });
    expect(res.status).toBe(400);
  });

  // routes/paymentMethods.js's PUT reuses the full create schema (pre-existing,
  // unrelated to this task), so name/type must be resent on every update.
  const cardBase = { name: 'QA Credit Card', type: 'Credit' };

  it('rejects a rate with more than 6 decimal places on a payment method', async () => {
    const res = await put(`/api/payment-methods/${harness.ids.card}`, { ...cardBase, default_cashback_rate: '2.1234567' });
    expect(res.status).toBe(400);
  });

  it('accepts a 6-decimal rate on a payment method and rejects an over-precision credit_limit', async () => {
    const ok = await put(`/api/payment-methods/${harness.ids.card}`, { ...cardBase, default_cashback_rate: '2.123456' });
    expect(ok.status).toBe(200);
    expect(ok.body.default_cashback_rate).toBe(2.123456);

    const bad = await put(`/api/payment-methods/${harness.ids.card}`, { ...cardBase, credit_limit: '5000.999' });
    expect(bad.status).toBe(400);
  });

  it('rejects an over-precision platform fee_pct', async () => {
    const res = await put(`/api/platforms/${harness.ids.vendor}`, { fee_pct: '1.2345678' });
    expect(res.status).toBe(400);
  });

  it('requires at most 2 decimal places for a money-metric goal target', async () => {
    const res = await post('/api/goals', { metric: 'netProfit', target_30d: '100.999' });
    expect(res.status).toBe(400);
  });

  it('accepts a 2-decimal money-metric goal target', async () => {
    const res = await post('/api/goals', { metric: 'totalRevenue', target_30d: '2500.50' });
    expect(res.status).toBe(200);
    expect(res.body.target_30d).toBe(2500.5);
  });

  it('rejects a non-integer target for a unitsSold goal', async () => {
    const res = await post('/api/goals', { metric: 'unitsSold', target_30d: '10.5' });
    expect(res.status).toBe(400);
  });

  it('accepts an integer target for a unitsSold goal', async () => {
    const res = await post('/api/goals', { metric: 'unitsSold', target_30d: '10' });
    expect(res.status).toBe(200);
    expect(res.body.target_30d).toBe(10);
  });

  it('validates an update against the existing goal\'s metric when the update omits it', async () => {
    const created = await post('/api/goals', { metric: 'unitsSold', target_7d: '5' });
    expect(created.status).toBe(200);

    // metric is not resent -- must still be validated as a count (integer),
    // inheriting the existing record's metric, not treated as money.
    const badUpdate = await put(`/api/goals/${created.body.id}`, { target_30d: '10.5' });
    expect(badUpdate.status).toBe(400);

    const goodUpdate = await put(`/api/goals/${created.body.id}`, { target_30d: '10' });
    expect(goodUpdate.status).toBe(200);
    expect(goodUpdate.body.target_30d).toBe(10);
  });
});
