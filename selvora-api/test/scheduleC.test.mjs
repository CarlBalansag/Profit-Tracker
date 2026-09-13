import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());
const request = async (path, method = 'GET', body, unauthenticated = false) => {
  const response = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Currency-Format': 'decimal', 'X-QA-Unauthenticated': String(unauthenticated) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
};
const details = (changes = {}) => ({ business_use: 'business', business_percent: '100', payee: 'Packing Store', purpose: 'Pack customer orders', tax_category: 'SUPPLIES', payment_status: 'paid', paid_date: '2026-01-01', payment_reference: 'Visa statement Jan, item 123', reviewed: true, ...changes });
const create = (amount, tax = details(), changes = {}) => request('expenses', 'POST', { name: 'Packing tape', amount, date: '2025-12-30', tax_details: tax, ...changes });
const enable = () => request('preferences/schedule-c', 'PUT', { enabled: true });
describe('Schedule C expense worksheet', () => {
  it('keeps preferences tenant-owned, typed and separate from dashboard settings; disable preserves records', async () => {
    harness.db.user[0].accounting_preferences = JSON.stringify({ dashboardSettings: { neon: { keep: true } } });
    expect((await request('preferences/schedule-c')).data.enabled).toBe(false);
    expect((await request('schedule-c?year=2026')).status).toBe(403);
    expect((await request('preferences/schedule-c', 'PUT', { enabled: 'false' })).status).toBe(400);
    expect((await request('preferences/schedule-c', 'PUT', { enabled: true, user_id: harness.ids.other })).status).toBe(400);
    expect((await enable()).status).toBe(200);
    expect(JSON.parse(harness.db.user[0].accounting_preferences).dashboardSettings.neon.keep).toBe(true);
    const entry = await create('100.00');
    await request('preferences/schedule-c', 'PUT', { enabled: false });
    expect(harness.db.expense.find(row => row.id === entry.data.id).tax_details.reviewed).toBe(true);
    expect((await request('schedule-c?year=2026')).status).toBe(403);
  });
  it('uses payment year across year boundaries and excludes other owners without writes', async () => {
    await enable();
    await create('100.00');
    await create('999.00', details({ paid_date: '2025-12-31' }));
    harness.db.expense.push({ ...harness.db.expense.at(-1), id: 'foreign', user_id: harness.ids.other, tax_details: details(), amount: 50000, amount_decimal: '50000.00' });
    const before = harness.calls.length;
    const report = await request('schedule-c?year=2026');
    expect(report.data.total).toBe('100.00');
    expect(report.data.rows.some(row => row.id === 'foreign')).toBe(false);
    expect(report.data.rows.some(row => row.amount === '999.00')).toBe(false);
    expect(harness.calls.slice(before).every(call => call.op.startsWith('find'))).toBe(true);
    expect(report.data.planning).toBe(true);
    expect((await request('schedule-c?year=2025')).data.planning).toBe(false);
  });
  it('conserves precise per-expense cents, applies mixed use without changing ordinary expense totals and itemizes other costs', async () => {
    await enable();
    const a = await create('0.10', details({ business_use: 'mixed', business_percent: '50' }));
    await create('0.20', details({ business_use: 'mixed', business_percent: '50' }));
    await create('0.01', details({ business_use: 'mixed', business_percent: '50' }));
    await create('8.00', details({ tax_category: 'POSTAGE' }));
    await create('2.00', details({ tax_category: 'SOFTWARE' }));
    const report = (await request('schedule-c?year=2026')).data;
    expect(report.groups.find(group => group.id === 'SUPPLIES').total).toBe('0.16');
    expect(report.total).toBe('10.16');
    expect(report.lines.find(line => line.line === '27b').total).toBe('10.00');
    expect(report.rows.find(row => row.id === a.data.id).amount).toBe('0.10');
    expect(harness.db.expense.find(row => row.id === a.data.id).amount_decimal).toBe('0.10');
    expect(report.groups.filter(group => ['POSTAGE', 'SOFTWARE'].includes(group.id)).every(group => group.line2025 === '27b')).toBe(true);
  });
  it('keeps old unknown dates in review; personal, unpaid and unreviewed costs never enter totals', async () => {
    await enable();
    await create('10', details({ payment_status: 'unknown', paid_date: '', reviewed: false }));
    await create('20', details({ business_use: 'personal' }));
    await create('30', details({ payment_status: 'unpaid', paid_date: '', reviewed: false }), { date: '2026-01-01' });
    await create('40', details({ reviewed: false }));
    const report = (await request('schedule-c?year=2026')).data;
    expect(report.total).toBe('0.00');
    expect(report.rows.filter(row => row.status === 'excluded')).toHaveLength(2);
    expect(report.rows.find(row => row.amount === '10.00').issues).toContain('Enter payment date');
    expect(report.rows.find(row => row.name === 'QA Storage').status).toBe('pending');
  });
  it('rejects invalid tax metadata and false reviewed claims before any write; permits incomplete drafts', async () => {
    for (const tax of [details({ business_percent: '101' }), details({ business_percent: -1 }), details({ business_percent: 12.345 }), details({ paid_date: '2026-02-31' }), details({ tax_category: 'MADE_UP' }), details({ reviewed: 'false' }), details({ payee: '' }), details({ business_use: 'mixed', business_percent: '0' }), details({ payment_status: 'unknown' })]) {
      expect((await create('10', tax)).status).toBe(400);
    }
    expect(harness.db.expense).toHaveLength(1);
    expect((await create('10', details({ payee: '', reviewed: false, business_percent: '12.34' }))).status).toBe(200);
  });
  it('preserves omitted tax metadata, invalidates reviewed financial changes, and supports failed-save retry/delete', async () => {
    await enable(); const entry = await create('100'); const path = `expenses/${entry.data.id}`;
    expect((await request(path, 'PUT', { notes: 'Updated notes' })).data.tax_details.reviewed).toBe(true);
    expect((await request(path, 'PUT', { amount: '120' })).data.tax_details.reviewed).toBe(false);
    const snapshot = structuredClone(harness.db.expense);
    harness.faults['expense.updateMany'] = true;
    expect((await request(path, 'PUT', { tax_details: details(), expected_tax_version: 2 })).status).toBe(500);
    expect(harness.db.expense).toEqual(snapshot);
    delete harness.faults['expense.updateMany'];
    await request(path, 'PUT', { tax_details: details(), expected_tax_version: 2 });
    await request(path, 'PUT', { tax_details: details(), expected_tax_version: 3 });
    expect((await request('schedule-c?year=2026')).data.total).toBe('120.00');
    await request(path, 'DELETE');
    expect((await request('schedule-c?year=2026')).data.total).toBe('0.00');
  });
  it('rejects foreign edits and unauthenticated access, and validates year parameters', async () => {
    const entry = await create('100'); harness.db.expense.find(row => row.id === entry.data.id).user_id = harness.ids.other;
    expect((await request(`expenses/${entry.data.id}`, 'PUT', { tax_details: details() })).status).toBe(404);
    expect((await request('schedule-c?year=2026', 'GET', undefined, true)).status).toBe(401);
    expect((await request('preferences/schedule-c', 'PUT', { enabled: true }, true)).status).toBe(401);
    await enable();
    for (const year of ['', 'abc', '10000', '1899', '2026.5']) expect((await request(`schedule-c?year=${year}`)).status).toBe(400);
  });
  it('leaves failed preferences unchanged and permits retry', async () => {
    harness.faults['user.update'] = true;
    expect((await enable()).status).toBe(500);
    expect((await request('preferences/schedule-c')).data.enabled).toBe(false);
    delete harness.faults['user.update'];
    expect((await enable()).data.enabled).toBe(true);
  });
  it('returns finite zero empty totals and rejects stale reviews after an ordinary expense edit', async () => {
    await enable(); harness.db.expense.length = 0;
    const empty = (await request('schedule-c?year=2030')).data;
    expect(empty.total).toBe('0.00'); expect(empty.rows).toEqual([]); expect(empty.pending).toBe(0);
    const entry = await create('25', details({ reviewed: false }));
    await request(`expenses/${entry.data.id}`, 'PUT', { amount: '30' });
    expect((await request(`expenses/${entry.data.id}`, 'PUT', { tax_details: details(), expected_tax_version: 0 })).status).toBe(409);
    expect((await request(`expenses/${entry.data.id}`, 'PUT', { tax_details: details() })).status).toBe(400);
    expect((await request('schedule-c?year=2026')).data.total).toBe('0.00');
    expect((await request('preferences/schedule-c', 'PUT')).status).toBe(400);
  });
});
