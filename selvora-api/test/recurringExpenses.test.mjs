import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
let server; let baseUrl;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
beforeEach(() => harness.reset());
afterAll(() => server.close());

describe('recurring expense dates', () => {
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
