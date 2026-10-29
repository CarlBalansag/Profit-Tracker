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

const FOREIGN_CARD = '99999999-9999-4999-8999-999999999999';
const DEBIT_CARD = 'abababab-abab-4bab-8bab-abababababab';
const addCards = () => {
  harness.db.paymentMethod.push({ id: FOREIGN_CARD, user_id: harness.ids.other, name: 'Not yours', type: 'Credit', default_cashback_rate: 0, category_rates: '[]' });
  harness.db.paymentMethod.push({ id: DEBIT_CARD, user_id: harness.ids.user, name: 'QA Debit', type: 'Debit', default_cashback_rate: 0, category_rates: '[]' });
};
const sale = () => harness.db.sales[0];

describe('label card on sales: every write path', () => {
  beforeEach(addCards);

  it('PUT /api/sales/:id sets, preserves on partial update, and clears the label card', async () => {
    let res = await request('PUT', `/api/sales/${harness.ids.sale}`, { sale_shipping_payment_method_id: harness.ids.card });
    expect(res.status).toBe(200);
    expect(sale().sale_shipping_payment_method_id).toBe(harness.ids.card);

    res = await request('PUT', `/api/sales/${harness.ids.sale}`, { sale_shipping: 9.5 });
    expect(res.status).toBe(200);
    expect(sale()).toMatchObject({ sale_shipping: 9.5, sale_shipping_payment_method_id: harness.ids.card });

    res = await request('PUT', `/api/sales/${harness.ids.sale}`, { sale_shipping_payment_method_id: '' });
    expect(res.status).toBe(200);
    expect(sale().sale_shipping_payment_method_id).toBe(null);
  });

  it('PUT /api/sales/:id rejects another user\'s card and leaves the sale unchanged', async () => {
    const before = structuredClone(sale());
    const res = await request('PUT', `/api/sales/${harness.ids.sale}`, { sale_shipping_payment_method_id: FOREIGN_CARD, sale_shipping: 1 });
    expect(res.status).toBe(404);
    expect(sale()).toEqual(before);
  });

  it('PUT /api/sales/:id rejects a malformed card id', async () => {
    const res = await request('PUT', `/api/sales/${harness.ids.sale}`, { sale_shipping_payment_method_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });

  it('POST /api/sales (Record Sale) stores the card, and an omitted card stays empty', async () => {
    let res = await request('POST', '/api/sales', { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 140, sale_shipping: 6.25, sale_shipping_payment_method_id: harness.ids.card });
    expect(res.status).toBe(200);
    expect(res.body.sale_shipping_payment_method_id).toBe(harness.ids.card);

    res = await request('POST', '/api/sales', { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 140, sale_shipping: 6.25 });
    expect(res.status).toBe(200);
    expect(res.body.sale_shipping_payment_method_id).toBe(null);
  });

  it('POST /api/sales rejects another user\'s card without selling any stock', async () => {
    const onHand = harness.db.inventory[0].qty_on_hand;
    const res = await request('POST', '/api/sales', { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 140, sale_shipping_payment_method_id: FOREIGN_CARD });
    expect(res.status).toBe(404);
    expect(harness.db.sales).toHaveLength(1);
    expect(harness.db.inventory[0].qty_on_hand).toBe(onHand);
  });

  it('POST /api/inventory with a sold section (Add Transaction) stores the card on the new sale', async () => {
    const res = await request('POST', '/api/inventory', {
      product_name: 'Label card item', unit_purchase_cost: 10, qty_purchased: 1, purchase_date: '2026-09-05',
      sale_price: 30, sale_tab: 'marketplace', marketplace_platform_id: harness.ids.platform, sale_shipping: 4.4,
      sale_shipping_payment_method_id: harness.ids.card,
    });
    expect(res.status).toBe(200);
    const created = harness.db.sales.find((s) => s.inventory_id === res.body.id);
    expect(created).toMatchObject({ sale_shipping: 4.4, sale_shipping_payment_method_id: harness.ids.card });
  });

  it('POST /api/inventory rejects another user\'s label card and creates nothing', async () => {
    const counts = [harness.db.inventory.length, harness.db.sales.length];
    const res = await request('POST', '/api/inventory', {
      product_name: 'Sneaky', unit_purchase_cost: 10, qty_purchased: 1, sale_price: 30, sale_shipping_payment_method_id: FOREIGN_CARD,
    });
    expect(res.status).toBe(404);
    expect([harness.db.inventory.length, harness.db.sales.length]).toEqual(counts);
  });

  it('PUT /api/inventory/:id/transaction (edit modal) saves, preserves, and checks ownership of the card', async () => {
    const path = `/api/inventory/${harness.ids.inventory}/transaction`;
    let res = await request('PUT', path, { inventory: {}, sales: [{ id: harness.ids.sale, sale_shipping_payment_method_id: harness.ids.card }] });
    expect(res.status).toBe(200);
    expect(sale().sale_shipping_payment_method_id).toBe(harness.ids.card);

    // An inline edit that never sends the field must not clear it.
    res = await request('PUT', path, { inventory: {}, sales: [{ id: harness.ids.sale, unit_price: 151 }] });
    expect(res.status).toBe(200);
    expect(sale()).toMatchObject({ unit_price: 151, sale_shipping_payment_method_id: harness.ids.card });

    res = await request('PUT', path, { inventory: {}, sales: [{ id: harness.ids.sale, sale_shipping_payment_method_id: FOREIGN_CARD }] });
    expect(res.status).toBe(404);
    expect(sale().sale_shipping_payment_method_id).toBe(harness.ids.card);

    res = await request('PUT', path, { inventory: {}, sales: [], newSale: { quantity: 1, unit_price: 99, sale_shipping: 3, sale_shipping_payment_method_id: harness.ids.card } });
    expect(res.status).toBe(200);
    expect(harness.db.sales.at(-1)).toMatchObject({ sale_shipping: 3, sale_shipping_payment_method_id: harness.ids.card });
  });

  it('GET /api/inventory returns the card on each sale', async () => {
    sale().sale_shipping_payment_method_id = harness.ids.card;
    const res = await get('/api/inventory');
    const listed = res.body.find((inv) => inv.id === harness.ids.inventory).sales[0];
    expect(listed.sale_shipping_payment_method_id).toBe(harness.ids.card);
    expect(listed.sale_shipping_payment_method).toMatchObject({ id: harness.ids.card, name: 'QA Credit Card' });
  });
});

describe('label card on the Expenses tab', () => {
  it('puts the card on the shipping-label line; platform fees and card-less labels are from the payout', async () => {
    let lines = (await get('/api/expenses/derived')).body;
    let label = lines.find((l) => l.category === 'SHIPPING_LABEL');
    expect(label).toMatchObject({ payment_method: null, paid_from_payout: true });

    sale().sale_shipping_payment_method_id = harness.ids.card;
    lines = (await get('/api/expenses/derived')).body;
    label = lines.find((l) => l.category === 'SHIPPING_LABEL');
    expect(label).toMatchObject({ payment_method_id: harness.ids.card, payment_method: { name: 'QA Credit Card' }, paid_from_payout: false });
    expect(lines.find((l) => l.category === 'SALE_PLATFORM_FEE')).toMatchObject({ payment_method: null, paid_from_payout: true });
  });
});

describe('label card spend on the Credit Card and Payment Methods pages', () => {
  beforeEach(addCards);
  const cardFor = async (month = '2026-09') => (await get(`/api/creditcard/dashboard?month=${month}`)).body.cards.find((c) => c.id === harness.ids.card);

  it('adds the label to card spend, cashback at the card default rate, and amount to pay in the sale month', async () => {
    const before = await cardFor();
    expect(before).toMatchObject({ totalSpend: 520, cashbackEarned: 10.4, txnCount: 1 });

    sale().sale_shipping_payment_method_id = harness.ids.card;
    const after = await cardFor();
    expect(after).toMatchObject({ totalSpend: 532, cashbackEarned: 10.64, txnCount: 2 });
    expect(after.amountToPay).toBe(532 - after.cashbackToRedeem);
    expect(after.items.find((item) => item.kind === 'shipping_label')).toMatchObject({
      saleId: harness.ids.sale, product: 'QA Multi-unit Sneaker · Shipping label', cost: 12, cashback: 0.24, revenue: null, cashbackRate: 2,
    });
    // The purchase and sale rows themselves are unchanged.
    expect(after.items.filter((item) => item.kind !== 'shipping_label')).toEqual(before.items);
    expect((await cardFor('2026-10')).totalSpend).toBe(0);
  });

  it('leaves the label off when the sale is cancelled, returned, or disputed', async () => {
    sale().sale_shipping_payment_method_id = harness.ids.card;
    for (const status of ['CANCELLED', 'RETURNED', 'DISPUTED']) {
      sale().status = status;
      const card = await cardFor();
      expect(card.items.some((item) => item.kind === 'shipping_label')).toBe(false);
    }
  });

  it('ignores debit-card labels on the Credit Card page but counts them in Payment Methods lifetime spend', async () => {
    sale().sale_shipping_payment_method_id = DEBIT_CARD;
    expect((await cardFor()).totalSpend).toBe(520);
    const methods = (await get('/api/payment-methods')).body;
    expect(methods.find((m) => m.id === DEBIT_CARD).total_spend).toBe(12);
    expect(methods.find((m) => m.id === harness.ids.card).total_spend).toBe(520);
  });

  it('Payment Methods lifetime spend matches the Credit Card page for a credit-card label and skips cancelled sales', async () => {
    sale().sale_shipping_payment_method_id = harness.ids.card;
    let methods = (await get('/api/payment-methods')).body;
    expect(methods.find((m) => m.id === harness.ids.card).total_spend).toBe((await cardFor()).totalSpend);
    sale().status = 'CANCELLED';
    methods = (await get('/api/payment-methods')).body;
    expect(methods.find((m) => m.id === harness.ids.card).total_spend).toBe(520);
  });

  it('does not change Dashboard revenue or profit (the label is already subtracted from the sale)', async () => {
    const before = (await get('/api/analytics/dashboard?mode=All&date=All%20Time')).body.stats;
    sale().sale_shipping_payment_method_id = harness.ids.card;
    const after = (await get('/api/analytics/dashboard?mode=All&date=All%20Time')).body.stats;
    expect(after).toEqual(before);
  });

  it('clears the label card when that payment method is deleted (the label then counts as from the payout)', async () => {
    sale().sale_shipping_payment_method_id = harness.ids.card;
    harness.db.paymentMethod = harness.db.paymentMethod.filter((m) => m.id !== harness.ids.card);
    const lines = (await get('/api/expenses/derived')).body;
    expect(lines.find((l) => l.category === 'SHIPPING_LABEL')).toMatchObject({ payment_method: null, paid_from_payout: true });
  });
});
