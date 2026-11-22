// Form 1099-K amounts entered by hand and compared with recorded sales by
// platform on the Schedule C page.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scheduleCBooks } = require('../services/scheduleCBooks');

const worksheet = { returns_and_allowances: { total: '0.00' }, total: '0.00', automatic: { total: '0.00' }, rows: [] };
const sale = (id, price, platform) => ({ id, quantity: 1, unit_price: price, commission_fee: 0, sale_shipping: 0, refunded_amount: 0, refunded_qty: 0, restored_qty: 0, status: 'SOLD', platform, sale_date: '2026-03-01T12:00:00Z', paid_at: null, sale_tax_collected: 0 });
const ebay = { id: 'p-ebay', name: 'eBay' };
const stockx = { id: 'p-stockx', name: 'StockX' };
const inv = { id: 'A', product_name: 'Shoe', purchase_date: '2026-02-01T12:00:00Z', unit_purchase_cost: 10, qty_purchased: 3, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, refunded_amount: 0, refunded_qty: 0, cashback_rate: 0, cashback_earned: 0,
  sales: [sale('s1', 100, ebay), sale('s2', 50, ebay), sale('s3', 80, stockx)] };
const platforms = [ebay, stockx, { id: 'p-mercari', name: 'Mercari' }].map((p) => ({ ...p, type: 'Marketplace' }));

describe('1099-K comparison in the books', () => {
  it('lines up each form with recorded sales on its platform', () => {
    const forms1099K = [
      { id: 'f1', payer_name: 'eBay', platform_id: 'p-ebay', gross_amount: '170.00', transaction_count: 2 },
      { id: 'f2', payer_name: 'PayPal', platform_id: null, gross_amount: '40.00', transaction_count: null },
      { id: 'f3', payer_name: 'Mercari', platform_id: 'p-mercari', gross_amount: '25.00', transaction_count: 1 },
    ];
    const { form1099K, notes, lines } = scheduleCBooks({ inventories: [inv], year: 2026, worksheet, forms1099K, platforms });
    expect(form1099K.comparison).toEqual([
      { platform_id: 'p-ebay', platform: 'eBay', recordedGross: '150.00', recordedCount: 2, formGross: '170.00', formCount: 2, difference: '20.00' },
      { platform_id: 'p-stockx', platform: 'StockX', recordedGross: '80.00', recordedCount: 1, formGross: null, formCount: null, difference: null },
      { platform_id: 'p-mercari', platform: 'Mercari', recordedGross: '0.00', recordedCount: 0, formGross: '25.00', formCount: 1, difference: '25.00' },
    ]);
    expect(form1099K.forms.map((f) => f.platform_name)).toEqual(['eBay', null, 'Mercari']);
    expect([form1099K.total, form1099K.unlinkedTotal]).toEqual(['235.00', '40.00']);
    // Gross receipts still come from the sales records, not the forms.
    expect(lines.find((l) => l.line === '1').amount).toBe('230.00');
    expect(notes.join(' ')).toMatch(/more than the sales you recorded on eBay, Mercari/);
  });

  it('adds up two forms for one platform and notes when sales are higher', () => {
    const forms1099K = [
      { id: 'a', payer_name: 'eBay', platform_id: 'p-ebay', gross_amount: 60, transaction_count: null },
      { id: 'b', payer_name: 'eBay (2nd account)', platform_id: 'p-ebay', gross_amount: 40, transaction_count: 1 },
    ];
    const { form1099K, notes } = scheduleCBooks({ inventories: [inv], year: 2026, worksheet, forms1099K, platforms });
    expect(form1099K.comparison[0]).toMatchObject({ platform: 'eBay', formGross: '100.00', formCount: 1, difference: '-50.00' });
    expect(notes.join(' ')).toMatch(/You recorded more sales on eBay than its 1099-K shows/);
  });

  it('is empty without forms', () => {
    const { form1099K, notes } = scheduleCBooks({ inventories: [inv], year: 2026, worksheet, platforms });
    expect(form1099K.forms).toEqual([]);
    expect(form1099K.total).toBe('0.00');
    expect(form1099K.comparison.every((r) => r.difference === null)).toBe(true);
    expect(notes.join(' ')).not.toMatch(/1099-K/);
  });
});

describe('1099-K routes', () => {
  const harness = require('../../qa/harness.cjs');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });
  const send = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const books = async () => (await (await fetch(`${base}/api/schedule-c?year=2026`)).json()).books;
  const form = (over) => ({ payer_name: 'QA Marketplace', platform_id: harness.ids.platform, gross_amount: '350.00', transaction_count: 3, ...over });

  it('adds, edits and deletes a form, and the page compares it with sales', async () => {
    const created = await send('POST', '/api/schedule-c/years/2026/1099-k', form());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ year: 2026, payer_name: 'QA Marketplace', platform_id: harness.ids.platform, gross_amount: '350', transaction_count: 3 });
    let b = await books();
    // The fixture sale: 2 x $150 on QA Marketplace in 2026.
    expect(b.form1099K.comparison.find((r) => r.platform_id === harness.ids.platform)).toMatchObject({ recordedGross: '300.00', formGross: '350.00', difference: '50.00' });
    expect(b.form1099K.platforms.map((p) => p.name)).toEqual(['QA Marketplace']); // vendors are not offered

    const edited = await send('PUT', `/api/schedule-c/1099-k/${created.body.id}`, { gross_amount: '300', platform_id: '', transaction_count: '' });
    expect(edited.body).toMatchObject({ gross_amount: '300', platform_id: null, transaction_count: null, payer_name: 'QA Marketplace' });
    b = await books();
    expect(b.form1099K.unlinkedTotal).toBe('300.00');

    expect((await send('DELETE', `/api/schedule-c/1099-k/${created.body.id}`)).status).toBe(200);
    expect(harness.db.taxForm1099K).toHaveLength(0);
    expect((await send('DELETE', `/api/schedule-c/1099-k/${created.body.id}`)).status).toBe(404);
  });

  it('rejects bad input and saves nothing', async () => {
    for (const bad of [form({ payer_name: '  ' }), form({ gross_amount: -1 }), form({ gross_amount: '1.005' }), form({ gross_amount: undefined }),
      form({ transaction_count: 1.5 }), form({ platform_id: 'not-a-uuid' }), form({ tin: '12-3456789' })]) {
      expect((await send('POST', '/api/schedule-c/years/2026/1099-k', bad)).status).toBe(400);
    }
    expect((await send('POST', '/api/schedule-c/years/26/1099-k', form())).status).toBe(400);
    expect(harness.db.taxForm1099K).toHaveLength(0);
  });

  it('keeps forms private to their owner', async () => {
    // Linking another user's platform is refused.
    expect((await send('POST', '/api/schedule-c/years/2026/1099-k', form({ platform_id: harness.ids.foreign }))).status).toBe(404);
    harness.db.taxForm1099K.push({ id: 'theirs', user_id: harness.ids.other, year: 2026, payer_name: 'Other', platform_id: null, gross_amount: 999, transaction_count: null });
    expect((await books()).form1099K.forms).toEqual([]);
    expect((await send('PUT', '/api/schedule-c/1099-k/theirs', { gross_amount: 1 })).status).toBe(404);
    expect((await send('DELETE', '/api/schedule-c/1099-k/theirs')).status).toBe(404);
    expect(harness.db.taxForm1099K[0].gross_amount).toBe(999);
    const mine = await send('POST', '/api/schedule-c/years/2026/1099-k', form());
    expect((await send('PUT', `/api/schedule-c/1099-k/${mine.body.id}`, { platform_id: harness.ids.foreign })).status).toBe(404);
  });

  it('needs Schedule C turned on', async () => {
    harness.db.user[0].schedule_c_enabled = false;
    expect((await send('POST', '/api/schedule-c/years/2026/1099-k', form())).status).toBe(403);
    expect(harness.db.taxForm1099K).toHaveLength(0);
  });
});
