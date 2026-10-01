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
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};
const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body);
const put = (path, body) => request('PUT', path, body);

describe('Expense payment method (card) selection', () => {
  it('creates an expense with a payment method and returns the nested card', async () => {
    const res = await post('/api/expenses', {
      name: 'Shipping labels', amount: 42.5, date: '2026-09-15', payment_method_id: harness.ids.card,
    });
    expect(res.status).toBe(200);
    expect(res.body.payment_method_id).toBe(harness.ids.card);
    expect(res.body.payment_method).toMatchObject({ id: harness.ids.card, name: 'QA Credit Card' });
  });

  it('creates an expense with no payment method (still optional)', async () => {
    const res = await post('/api/expenses', { name: 'Cash purchase', amount: 10, date: '2026-09-15' });
    expect(res.status).toBe(200);
    expect(res.body.payment_method_id).toBe(null);
    expect(res.body.payment_method).toBe(null);
  });

  it('rejects a foreign payment method on create', async () => {
    harness.db.paymentMethod.push({ id: '99999999-9999-4999-8999-999999999999', user_id: harness.ids.other, name: 'Not yours', type: 'Credit', default_cashback_rate: 0, category_rates: '[]' });
    const res = await post('/api/expenses', { name: 'Sneaky', amount: 10, date: '2026-09-15', payment_method_id: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(404);
  });

  it('updates an expense to attach, then clear, a payment method', async () => {
    const created = await post('/api/expenses', { name: 'Storage unit', amount: 80, date: '2026-09-15' });
    const attach = await put(`/api/expenses/${created.body.id}`, { payment_method_id: harness.ids.card });
    expect(attach.status).toBe(200);
    expect(attach.body.payment_method_id).toBe(harness.ids.card);

    const clear = await put(`/api/expenses/${created.body.id}`, { payment_method_id: '' });
    expect(clear.status).toBe(200);
    expect(clear.body.payment_method_id).toBe(null);
  });

  it('rejects a foreign payment method on update', async () => {
    harness.db.paymentMethod.push({ id: '99999999-9999-4999-8999-999999999999', user_id: harness.ids.other, name: 'Not yours', type: 'Credit', default_cashback_rate: 0, category_rates: '[]' });
    const created = await post('/api/expenses', { name: 'Storage unit', amount: 80, date: '2026-09-15' });
    const res = await put(`/api/expenses/${created.body.id}`, { payment_method_id: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(404);
  });

  it('GET list includes the nested card for an expense that has one', async () => {
    await post('/api/expenses', { name: 'Software', amount: 15, date: '2026-09-15', payment_method_id: harness.ids.card });
    const res = await get('/api/expenses');
    const withCard = res.body.find(e => e.name === 'Software');
    expect(withCard.payment_method.name).toBe('QA Credit Card');
  });
});

describe('Recurring expense payment method propagates to generated entries', () => {
  it('a recurring expense with a card generates Expense entries carrying that same card', async () => {
    const res = await post('/api/recurring-expenses', {
      name: 'Storage subscription', amount: 20, frequency: 'monthly',
      start_date: '2026-08-01', payment_method_id: harness.ids.card,
    });
    expect(res.status).toBe(200);
    expect(res.body.payment_method_id).toBe(harness.ids.card);
    expect(res.body.payment_method.name).toBe('QA Credit Card');

    const generated = harness.db.expense.filter(e => e.recurring_expense_id === res.body.id);
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every(e => e.payment_method_id === harness.ids.card)).toBe(true);
  });

  it('rejects a foreign payment method on recurring expense create and update', async () => {
    harness.db.paymentMethod.push({ id: '99999999-9999-4999-8999-999999999999', user_id: harness.ids.other, name: 'Not yours', type: 'Credit', default_cashback_rate: 0, category_rates: '[]' });
    const bad = await post('/api/recurring-expenses', { name: 'x', amount: 5, frequency: 'monthly', start_date: '2026-09-01', payment_method_id: '99999999-9999-4999-8999-999999999999' });
    expect(bad.status).toBe(404);

    const created = await post('/api/recurring-expenses', { name: 'ok', amount: 5, frequency: 'monthly', start_date: '2026-09-01' });
    const badUpdate = await put(`/api/recurring-expenses/${created.body.id}`, { payment_method_id: '99999999-9999-4999-8999-999999999999' });
    expect(badUpdate.status).toBe(404);
  });
});
