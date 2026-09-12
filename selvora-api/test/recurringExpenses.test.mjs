import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
let server; let baseUrl;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
beforeEach(() => harness.reset());
afterAll(() => server.close());

describe('recurring expense dates', () => {
  it('rejects a reversed create date range before writing a template', async () => {
    const response = await fetch(`${baseUrl}/api/recurring-expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Invalid range', amount: 1, frequency: 'monthly', start_date: '2026-02-01', end_date: '2026-01-01' }) });
    expect(response.status).toBe(400);
    expect(harness.db.recurringExpense).toHaveLength(0);
  });
  it('rolls back template creation and generated entries if updating the marker fails, then retries cleanly', async () => {
    const body = { name: 'Atomic monthly', amount: '0.29', frequency: 'monthly', start_date: '2026-01-31', end_date: '2026-04-30' };
    const write = () => fetch(`${baseUrl}/api/recurring-expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    harness.faults['recurringExpense.update'] = true;
    expect((await write()).status).toBe(500);
    expect(harness.db.recurringExpense).toHaveLength(0);
    expect(harness.db.expense.filter(e => e.recurring_expense_id)).toHaveLength(0);
    harness.faults['recurringExpense.update'] = false;
    expect((await write()).status).toBe(200);
    expect(harness.db.recurringExpense).toHaveLength(1);
    expect(harness.db.expense.filter(e => e.recurring_expense_id)).toHaveLength(4);
    await fetch(`${baseUrl}/api/recurring-expenses`);
    await fetch(`${baseUrl}/api/recurring-expenses`);
    expect(harness.db.expense.filter(e => e.recurring_expense_id)).toHaveLength(4);
  });
  it('rejects a partial end-date change before the saved start and preserves the record', async () => {
    const created = await fetch(`${baseUrl}/api/recurring-expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Future monthly', amount: 1, frequency: 'monthly', start_date: '2090-01-31' }) });
    const record = await created.json();
    const original = structuredClone(harness.db.recurringExpense[0]);
    const response = await fetch(`${baseUrl}/api/recurring-expenses/${record.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ end_date: '2089-01-01' }) });
    expect(response.status).toBe(400);
    expect(harness.db.recurringExpense[0]).toEqual(original);
  });
  it('clamps month-end recurrences to February instead of skipping it', async () => {
    const response = await fetch(`${baseUrl}/api/recurring-expenses`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Month end', amount: 1, frequency: 'monthly', start_date: '2026-01-31', end_date: '2026-04-30' }),
    });
    expect(response.status).toBe(200);
    const dates = harness.db.expense.filter((expense) => expense.recurring_expense_id).map((expense) => expense.date.toISOString().slice(0, 10));
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});
