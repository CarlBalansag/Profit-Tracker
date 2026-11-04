import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
let server, baseUrl;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const payload = await response.json();
  if (payload.error) return { isError: true, data: payload.error.message };
  const text = payload.result.content?.[0]?.text;
  return { isError: payload.result.isError || false, data: text && !payload.result.isError ? JSON.parse(text) : text };
}
const sale = () => harness.db.sales[0];
const updateSale = (args) => callTool('update_sale', { sale_id: ids.sale, ...args });
const addSale = (args) => callTool('add_sale', { inventory_id: ids.inventory, qty: 1, sale_price: 150, sale_date: '2026-09-10', platform: 'QA Marketplace', ...args });

describe('AI assistant: shipping-label card', () => {
  it('update_sale sets the card by name, keeps it on other edits, and clears it', async () => {
    let res = await updateSale({ label_paid_with: 'qa credit card' });
    expect(res.isError).toBe(false);
    expect(res.data.label_card_id).toBe(ids.card);
    expect(sale().sale_shipping_payment_method_id).toBe(ids.card);

    res = await updateSale({ shipping: 9.5 });
    expect(res.data.label_card_id).toBe(ids.card);
    expect(sale()).toMatchObject({ sale_shipping: 9.5, sale_shipping_payment_method_id: ids.card });

    res = await updateSale({ label_paid_with: '' });
    expect(res.data.label_card_id).toBe(null);
    expect(sale().sale_shipping_payment_method_id).toBe(null);
  });

  it('logs the change for the history', async () => {
    await updateSale({ label_paid_with: 'QA Credit Card' });
    expect(harness.db.changeLog.some(c => c.field === 'sale_shipping_payment_method_id' && c.record_id === ids.sale)).toBe(true);
  });

  it('update_sale refuses an unknown card, lists the real ones, and saves nothing', async () => {
    const before = structuredClone({ sale: sale(), inv: harness.db.inventory[0] });
    const res = await updateSale({ label_paid_with: 'Nope Card', qty: 1 });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/No payment method named "Nope Card".*QA Credit Card/);
    expect(sale()).toEqual(before.sale);
    expect(harness.db.inventory[0]).toEqual(before.inv);
  });

  it('never resolves another user\'s card', async () => {
    harness.db.paymentMethod.push({ id: '99999999-9999-4999-8999-999999999999', user_id: ids.other, name: 'Their Card', type: 'Credit', default_cashback_rate: 0, category_rates: '[]' });
    const res = await updateSale({ label_paid_with: 'Their Card' });
    expect(res.isError).toBe(true);
    expect(sale().sale_shipping_payment_method_id ?? null).toBe(null);
  });

  it('add_sale records shipping and the label card', async () => {
    const res = await addSale({ shipping: 7.12, label_paid_with: 'QA Credit Card' });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ shipping: 7.12, label_card_id: ids.card });
    expect(harness.db.sales.at(-1)).toMatchObject({ sale_shipping: 7.12, sale_shipping_payment_method_id: ids.card });
  });

  it('add_sale defaults to no shipping and no card', async () => {
    const res = await addSale({});
    expect(res.data).toMatchObject({ shipping: 0, label_card_id: null });
  });

  it('add_sale with an unknown card sells nothing', async () => {
    const onHand = harness.db.inventory[0].qty_on_hand;
    const count = harness.db.sales.length;
    const res = await addSale({ label_paid_with: 'Nope Card' });
    expect(res.isError).toBe(true);
    expect(harness.db.inventory[0].qty_on_hand).toBe(onHand);
    expect(harness.db.sales).toHaveLength(count);
  });

  it('a card set by the assistant counts on the Credit Card page', async () => {
    await updateSale({ label_paid_with: 'QA Credit Card' });
    const dashboard = await (await fetch(`${baseUrl}/api/creditcard/dashboard?month=2026-09`)).json();
    expect(dashboard.cards.find(c => c.id === ids.card).totalSpend).toBe(532);
  });
});
