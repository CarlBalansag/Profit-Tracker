import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });

const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
};
const worksheet = async (year = 2026) => (await request(`schedule-c?year=${year}`)).data;
const group = (report, id) => report.groups.find(g => g.id === id);
const line = (report, id) => report.lines.find(l => l.line === id);
const reviewed = (changes = {}) => ({ business_use: 'business', business_percent: '100', payee: 'Pirate Ship', purpose: 'Label', tax_category: 'POSTAGE', payment_status: 'paid', paid_date: '2026-09-04', payment_reference: 'Visa', reviewed: true, ...changes });
const sale = () => harness.db.sales[0];

describe('Schedule C: sale costs included automatically', () => {
  it('puts the sale\'s shipping label on postage (27b) and its platform fee on line 10, with no review needed', async () => {
    // Fixture sale 2026-09-03 on "QA Marketplace": label $12, fee $15. Manual "QA Storage" $25 is unreviewed.
    const report = await worksheet();
    expect(group(report, 'POSTAGE')).toMatchObject({ total: '12.00', count: 1 });
    expect(group(report, 'FEES')).toMatchObject({ total: '15.00', count: 1 });
    expect(line(report, '10').total).toBe('15.00');
    expect(line(report, '27b').total).toBe('12.00');
    expect(report.total).toBe('27.00');
    expect(report.automatic).toEqual({ total: '27.00', count: 2 });
    expect(report.pending).toBe(1); // only the manual expense still needs review

    const label = report.rows.find(r => r.name === 'QA Multi-unit Sneaker · Shipping label');
    expect(label).toMatchObject({ source: 'sale', status: 'automatic', amount: '12.00', eligible: '12.00', issues: [], documentation_missing: false, sale_id: harness.ids.sale, inventory_id: harness.ids.inventory });
    expect(label.tax_details).toMatchObject({ tax_category: 'POSTAGE', business_use: 'business', payment_status: 'paid', paid_date: '2026-09-03', payee: 'Shipping label (from payout)' });
    const fee = report.rows.find(r => r.name === 'QA Multi-unit Sneaker · Platform fee');
    expect(fee.tax_details).toMatchObject({ tax_category: 'FEES', payee: 'QA Marketplace', paid_date: '2026-09-03' });
    expect(report.documentation_gaps).toBe(1); // sale rows never count as missing receipts
  });

  it('names the label card as the payee when the label was bought on a card', async () => {
    sale().sale_shipping_payment_method_id = harness.ids.card;
    const label = (await worksheet()).rows.find(r => r.tax_details.tax_category === 'POSTAGE');
    expect(label.tax_details.payee).toBe('Shipping label (QA Credit Card)');
  });

  it('never lists purchase tax, inbound shipping, purchase fees or gift cards in Part II, but reports them as cost of goods', async () => {
    const report = await worksheet();
    expect(report.rows.some(r => /Sales tax|Inbound shipping|Purchase fee|Gift card/.test(r.name))).toBe(false);
    // Fixture purchase 2026-09-01: tax 40 + shipping 20 + fees 10 - gift card 50.
    expect(report.inventory_costs_excluded).toEqual({ total: '20.00', count: 4 });
    expect(group(report, 'SUPPLIES').total).toBe('0.00');
  });

  it('places sale costs in the tax year of the sale date and leaves other years empty', async () => {
    sale().sale_date = new Date('2025-12-31T12:00:00Z');
    expect((await worksheet(2026)).automatic).toEqual({ total: '0.00', count: 0 });
    const report2025 = await worksheet(2025);
    expect(report2025.automatic).toEqual({ total: '27.00', count: 2 });
    expect(report2025.planning).toBe(false);
  });

  it.each(['CANCELLED', 'RETURNED', 'DISPUTED'])('leaves %s sales out, matching every other total', async (status) => {
    sale().status = status;
    const report = await worksheet();
    expect(report.automatic).toEqual({ total: '0.00', count: 0 });
    expect(report.total).toBe('0.00');
  });

  it('follows edits and deletes of the sale without anything stored', async () => {
    const before = harness.db.expense.length;
    sale().sale_shipping = 7.12;
    expect(group(await worksheet(), 'POSTAGE').total).toBe('7.12');
    expect((await request(`inventory/${harness.ids.inventory}`, 'DELETE')).status).toBe(200);
    expect((await worksheet()).automatic).toEqual({ total: '0.00', count: 0 });
    expect(harness.db.expense.length).toBe(before);
  });

  it('adds sale costs to reviewed manual expenses without changing how manual rows are reviewed', async () => {
    await request('expenses', 'POST', { name: 'Bubble mailers', amount: 9.99, date: '2026-09-20', tax_details: reviewed({ tax_category: 'SUPPLIES', paid_date: '2026-09-20' }) });
    const report = await worksheet();
    expect(group(report, 'SUPPLIES').total).toBe('9.99');
    expect(report.total).toBe('36.99');
    expect(report.rows.find(r => r.name === 'Bubble mailers')).toMatchObject({ source: 'manual', status: 'reviewed', possible_duplicate_of: null });
  });

  it('flags a manual expense that matches a sale\'s label within 7 days, but still lets the user decide', async () => {
    await request('expenses', 'POST', { name: 'Pirate Ship label', amount: 12, date: '2026-09-04', tax_details: reviewed() });
    await request('expenses', 'POST', { name: 'Far-away label', amount: 12, date: '2026-09-20', tax_details: reviewed({ paid_date: '2026-09-20' }) });
    await request('expenses', 'POST', { name: 'Different amount', amount: 12.01, date: '2026-09-04', tax_details: reviewed() });
    const report = await worksheet();
    const byName = name => report.rows.find(r => r.name === name);
    expect(byName('Pirate Ship label').possible_duplicate_of).toBe('QA Multi-unit Sneaker · Shipping label');
    expect(byName('Far-away label').possible_duplicate_of).toBe(null);
    expect(byName('Different amount').possible_duplicate_of).toBe(null);
    expect(report.possible_duplicates).toBe(1);
    // Flagging does not silently drop it: the reviewed amount still counts until the user deletes it.
    expect(group(report, 'POSTAGE').total).toBe('48.01');
  });

  it('does not flag an excluded (personal) manual expense', async () => {
    await request('expenses', 'POST', { name: 'Personal label', amount: 12, date: '2026-09-04', tax_details: reviewed({ business_use: 'personal' }) });
    expect((await worksheet()).rows.find(r => r.name === 'Personal label').possible_duplicate_of).toBe(null);
  });

  it('returns finite zero totals for a year with nothing in it', async () => {
    const report = await worksheet(2030);
    expect(report).toMatchObject({ total: '0.00', automatic: { total: '0.00', count: 0 }, inventory_costs_excluded: { total: '0.00', count: 0 }, possible_duplicates: 0 });
    // Only the undated manual expense remains (undated expenses stay visible in every year by design).
    expect(report.rows.map(r => r.source)).toEqual(['manual']);
  });

  it('never includes another user\'s sales', async () => {
    harness.db.inventory.push({ ...harness.db.inventory[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: harness.ids.other, product_name: 'Private item' });
    harness.db.sales.push({ ...sale(), id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', inventory_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const report = await worksheet();
    expect(report.rows.some(r => r.name.startsWith('Private item'))).toBe(false);
    expect(report.automatic.total).toBe('27.00');
  });

  it('agrees with the Expenses tab and the Dashboard on the same sale costs', async () => {
    const report = await worksheet();
    const derived = (await request('expenses/derived')).data.filter(l => l.source === 'sale');
    const { stats } = (await request('analytics/dashboard?mode=All&date=All%20Time')).data;
    expect(Number(group(report, 'POSTAGE').total)).toBe(stats.saleShipping);
    expect(Number(group(report, 'FEES').total)).toBe(stats.commissionFees);
    expect(Number(report.automatic.total)).toBe(derived.reduce((sum, l) => sum + l.amount, 0));
  });
});
