import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });

const refund = (body) => fetch(`${base}/api/refunds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const worksheet = async (year = 2026) => (await fetch(`${base}/api/schedule-c?year=${year}`)).json();

describe('Schedule C: returns and allowances', () => {
  it('is zero with no refunds', async () => {
    expect((await worksheet()).returns_and_allowances).toEqual({ line: '2', total: '0.00', count: 0 });
  });

  it('reports refunds to buyers on line 2 and keeps them out of the expense total', async () => {
    const before = await worksheet();
    await refund({ sale_id: ids.sale, amount: 150.25, quantity: 1, date: '2026-09-20' });
    await refund({ sale_id: ids.sale, amount: 10, date: '2026-09-21' });
    const after = await worksheet();
    expect(after.returns_and_allowances).toEqual({ line: '2', total: '160.25', count: 2 });
    expect(after.total).toBe(before.total);
    expect(after.groups).toEqual(before.groups);
    expect(after.rows.some(r => /refund/i.test(r.name))).toBe(false);
  });

  it('ignores store refunds, which belong to cost of goods', async () => {
    await refund({ inventory_id: ids.inventory, amount: 52, date: '2026-09-20' });
    expect((await worksheet()).returns_and_allowances.count).toBe(0);
  });

  it('counts a refund in the year the money went back, not the year of the sale', async () => {
    await refund({ sale_id: ids.sale, amount: 25, date: '2027-01-05' });
    expect((await worksheet(2026)).returns_and_allowances.count).toBe(0);
    expect((await worksheet(2027)).returns_and_allowances).toMatchObject({ total: '25.00', count: 1 });
  });

  it('leaves out a sale that was later cancelled, like every other total', async () => {
    await refund({ sale_id: ids.sale, amount: 25, date: '2026-09-20' });
    harness.db.sales[0].status = 'CANCELLED';
    expect((await worksheet()).returns_and_allowances.count).toBe(0);
  });

  it('never includes another user\'s refunds', async () => {
    harness.db.refund.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: ids.other, sale_id: ids.sale, amount: 99, quantity: 0, date: new Date('2026-09-20T12:00:00Z') });
    expect((await worksheet()).returns_and_allowances.count).toBe(0);
  });
});
