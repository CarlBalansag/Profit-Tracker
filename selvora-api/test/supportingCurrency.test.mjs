import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());
const write = async (path, body, method = 'POST') => { const response = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
describe('supporting currency flows', () => {
  it('creates/partially updates/zeros expenses with two-cent precision', async () => {
    const created = await write('expenses', { name: 'Decimal expense', amount: '0.29', date: '2026-09-01' });
    expect(created.data.amount_decimal).toBe('0.29');
    expect((await write(`expenses/${created.data.id}`, { notes: 'Preserve' }, 'PUT')).data.amount_decimal).toBe('0.29');
    expect((await write(`expenses/${created.data.id}`, { amount: 0 }, 'PUT')).data.amount_decimal).toBe('0.00');
    expect((await write('expenses', { name: 'Invalid', amount: '0.001', date: '2026-09-01' })).status).toBe(400);
  });
  it('generates recurring occurrences with the exact template amount and preserves partial changes', async () => {
    const created = await write('recurring-expenses', { name: 'Recurring cents', amount: '0.29', frequency: 'monthly', start_date: '2026-09-01' });
    expect(created.data.amount_decimal).toBe('0.29');
    const entries = harness.db.expense.filter(item => item.recurring_expense_id === created.data.id);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(item => item.amount_decimal === '0.29')).toBe(true);
    const updated = await write(`recurring-expenses/${created.data.id}`, { notes: 'Preserve' }, 'PUT');
    expect(updated.data.amount_decimal).toBe('0.29');
  });
  it('uses rate scale, preserves omitted card values and supports intentional zero/null limits', async () => {
    const created = await write('payment-methods', { name: 'Decimal card', type: 'Credit', default_cashback_rate: '2.123456', credit_limit: 0, min_payment_pct: '1.234567', category_rates: [{ store: 'Vendor', rate: '5.123456' }] });
    expect(created.status).toBe(200);
    expect(created.data.default_cashback_rate_decimal).toBe('2.123456');
    expect(created.data.credit_limit_decimal).toBe('0.00');
    const partial = await write(`payment-methods/${created.data.id}`, { credit_limit: '100.01' }, 'PUT');
    expect(partial.data.default_cashback_rate).toBe(2.123456);
    expect(partial.data.min_payment_pct_decimal).toBe('1.234567');
    expect((await write(`payment-methods/${created.data.id}`, { credit_limit: null, min_payment_pct: 0 }, 'PUT')).data.credit_limit_decimal).toBeNull();
    expect((await write('payment-methods', { name: 'Bad', type: 'Credit', category_rates: [{ store: 'Vendor', rate: '1.1234567' }] })).status).toBe(400);
  });
  it('writes marketplace rates without cent rounding and rejects excessive percentage inputs', async () => {
    const created = await write('platforms', { name: 'Decimal market', type: 'Marketplace', fee_pct: '7.123456' });
    expect(created.data.fee_pct_decimal).toBe('7.123456');
    expect((await write('platforms', { name: 'Bad', fee_pct: '100.1' })).status).toBe(400);
  });
  it('keeps monetary and whole-unit goals distinct on create and partial update', async () => {
    const monetary = await write('goals', { metric: 'netProfit', target_7d: '100.01' });
    expect(monetary.data.target_7d_decimal).toBe('100.01');
    const units = await write('goals', { metric: 'unitsSold', target_7d: 3 });
    expect(units.data.target_7d_decimal).toBeNull();
    expect((await write(`goals/${units.data.id}`, { target_7d: 4 }, 'PUT')).data.target_7d_decimal).toBeNull();
    expect((await write(`goals/${units.data.id}`, { target_7d: 3.5 }, 'PUT')).status).toBe(400);
  });
});
