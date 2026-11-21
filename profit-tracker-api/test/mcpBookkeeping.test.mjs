import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
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
  if (payload.error) return { rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { isError: result.isError || false, data };
}

const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const writes = () => harness.calls.filter((c) => WRITE_OPS.has(c.op));

// Fixture (qa/harness.cjs): one purchase of 5 at $100 with $40 tax, $20
// inbound shipping, $10 fees and a $50 gift card (receipt total $520), bought
// 2026-09-01 at "QA Store" on "QA Credit Card"; one sale of 2 at $150 with $15
// commission and a $12 label on 2026-09-03 via "QA Marketplace" (net $273);
// one $25 "QA Storage" expense on 2026-09-01.
const inv = () => harness.db.inventory[0];
const sale = () => harness.db.sales[0];
let extra = 0;
function addSale(fields = {}) {
  extra += 1;
  const id = `aaaaaaaa-0000-4000-8000-${String(extra).padStart(12, '0')}`;
  harness.db.sales.push({
    ...structuredClone(sale()), id, quantity: 1, commission_fee: 0, sale_shipping: 0, unit_price: 100,
    workflow_status: 'WAITING_FOR_PAYMENT', tracking_number: null, notes: null, ...fields,
  });
  return id;
}
function addPurchase(fields = {}) {
  extra += 1;
  const id = `bbbbbbbb-0000-4000-8000-${String(extra).padStart(12, '0')}`;
  harness.db.inventory.push({ ...structuredClone(inv()), id, ...fields });
  return id;
}

describe('find_records', () => {
  it('finds a purchase by inbound tracking, ignoring spaces, with its linked sales', async () => {
    const { data } = await callTool('find_records', { query: '9400 1118 9922 3856 9284 99', fields: ['tracking_number'] });
    expect(data.total).toBe(1);
    expect(data.results[0]).toMatchObject({ type: 'purchase', id: harness.ids.inventory, sale_ids: [harness.ids.sale], matched_on: ['tracking_number'] });
  });

  it('finds a sale by outbound tracking with its payout_status and purchase', async () => {
    sale().tracking_number = '1Z999AA10123456784';
    const { data } = await callTool('find_records', { query: '1z999aa1', fields: ['tracking_number'] });
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({ type: 'sale', id: harness.ids.sale, payout_status: 'unpaid', purchase_id: harness.ids.inventory, net: 273 });
  });

  it('finds the purchase and its sale by the purchase order number', async () => {
    inv().order_number = '112-7654321-0000001';
    const { data } = await callTool('find_records', { query: '1127654321', fields: ['order_number'] });
    expect(data.results.map((r) => r.type).sort()).toEqual(['purchase', 'sale']);
    expect(data.results.find((r) => r.type === 'sale').matched_on).toEqual(['purchase_order_number']);
  });

  it('finds by partial product name, and an ASIN kept in notes or a transaction note', async () => {
    const byName = await callTool('find_records', { query: 'multi-unit', types: ['purchase'] });
    expect(byName.data.results).toHaveLength(1);
    inv().notes = 'ASIN B0ABC12345';
    expect((await callTool('find_records', { query: 'b0abc12345' })).data.results[0].matched_on).toEqual(['notes']);
    harness.db.transactionNote.push({ id: 'cccccccc-0000-4000-8000-000000000001', user_id: harness.ids.user, entity_type: 'sale', entity_id: harness.ids.sale, body: 'UPC 0123456789012', deleted_at: null, created_at: new Date() });
    const byUpc = await callTool('find_records', { query: '0123456789012' });
    expect(byUpc.data.results.map((r) => r.id)).toEqual([harness.ids.sale]);
  });

  it('never returns another user\'s records', async () => {
    addPurchase({ user_id: harness.ids.other, product_name: 'QA Multi-unit Sneaker Private' });
    const { data } = await callTool('find_records', { query: 'sneaker', types: ['purchase'] });
    expect(data.results.map((r) => r.id)).toEqual([harness.ids.inventory]);
  });

  it('rejects a blank query and writes nothing', async () => {
    expect((await callTool('find_records', { query: '   ' })).isError).toBe(true);
    await callTool('find_records', { query: 'sneaker' });
    expect(writes()).toEqual([]);
  });
});

describe('reconcile_transactions', () => {
  it('matches a card charge to the purchase receipt total and an expense by amount and date', async () => {
    const { data } = await callTool('reconcile_transactions', {
      transactions: [
        { id: 't1', date: '2026-09-02', amount: -520, merchant: 'QA STORE #123', account: 'QA Credit Card' },
        { id: 't2', date: '2026-09-01', amount: -25, merchant: 'QA Storage LLC' },
      ],
    });
    const [t1, t2] = data.matched;
    expect(t1.transaction.id).toBe('t1');
    expect(t1.best).toMatchObject({ match_type: 'purchase', part: 'total', record_id: harness.ids.inventory, tier: 'amount_date', days_apart: 1, direction: 'out' });
    expect(t1.best.confidence).toBeGreaterThan(0.9);
    expect(t2.best).toMatchObject({ match_type: 'expense', tier: 'amount_date' });
  });

  it('matches one deposit to every sale it paid, summed', async () => {
    Object.assign(sale(), { workflow_status: 'PAID', paid_at: new Date('2026-10-08T12:00:00Z'), paid_amount: 273, payout_account: 'PayPal', paid_reference: 'D1' });
    const second = addSale({ workflow_status: 'PAID', paid_at: new Date('2026-10-08T12:00:00Z'), paid_amount: 100, payout_account: 'PayPal', paid_reference: 'D1' });
    const { data } = await callTool('reconcile_transactions', { transactions: [{ date: '2026-10-09', amount: 373, merchant: 'PAYPAL TRANSFER' }] });
    expect(data.matched[0].best).toMatchObject({ match_type: 'payout', direction: 'in', amount: 373, tier: 'amount_date' });
    expect(data.matched[0].best.record_ids.sort()).toEqual([harness.ids.sale, second].sort());
  });

  it('falls back to amount-only outside the tolerance, and to merchant for a near amount', async () => {
    const { data } = await callTool('reconcile_transactions', {
      transactions: [
        { date: '2026-09-20', amount: -520 },
        { date: '2026-09-01', amount: -26, merchant: 'QA Storage' },
      ],
      tolerance_days: 2,
    });
    expect(data.matched[0].best.tier).toBe('amount');
    expect(data.matched[1].best).toMatchObject({ tier: 'merchant', match_type: 'expense' });
  });

  it('treats an expense already holding the transaction id as a certain match', async () => {
    harness.db.expense[0].external_id = 'copilot-42';
    const { data } = await callTool('reconcile_transactions', { transactions: [{ id: 'copilot-42', date: '2026-09-15', amount: -30 }] });
    expect(data.matched[0].best).toMatchObject({ tier: 'external_id', confidence: 1, match_type: 'expense' });
  });

  it('reports unmatched transactions and the tracker records nothing matched', async () => {
    const { data } = await callTool('reconcile_transactions', {
      transactions: [{ id: 'x', date: '2026-09-02', amount: -999.99, merchant: 'Nowhere' }, { date: '2026-09-02', amount: -520 }],
    });
    expect(data.unmatched_transactions.map((t) => t.id)).toEqual(['x']);
    const leftover = data.unmatched_records.map((r) => `${r.match_type}:${r.part || ''}`).sort();
    // The $25 expense and the $12 label are in range and unmatched; the
    // matched purchase total, the purchase's parts and the platform fee are not listed.
    expect(leftover).toEqual(['expense:', 'sale_cost:shipping_label']);
    expect(data.summary).toMatchObject({ transactions: 2, matched: 1, unmatched: 1 });
  });

  it('leaves cancelled purchases out and writes nothing', async () => {
    inv().cancelled_at = new Date();
    const { data } = await callTool('reconcile_transactions', { transactions: [{ date: '2026-09-02', amount: -520 }] });
    expect(data.unmatched_transactions).toHaveLength(1);
    expect(writes()).toEqual([]);
  });

  it('validates the input', async () => {
    expect((await callTool('reconcile_transactions', { transactions: [] })).isError).toBe(true);
    expect((await callTool('reconcile_transactions', { transactions: [{ date: '9/2/2026', amount: 1 }] })).isError).toBe(true);
  });
});

describe('list_all_costs', () => {
  it('lists manual, purchase and sale costs with totals by month, category and source', async () => {
    const { data } = await callTool('list_all_costs', { start_date: '2026-09-01', end_date: '2026-09-30' });
    // 25 expense + (40 tax + 20 shipping + 10 fees - 50 gift card) + (12 label + 15 fee)
    expect(data.total).toBe(72);
    expect(data.by_month).toEqual({ '2026-09': 72 });
    expect(data.by_source).toEqual({ expense: 25, purchase: 20, sale: 27 });
    expect(data.by_category).toMatchObject({ PURCHASE_TAX: 40, GIFT_CARD_CREDIT: -50, SHIPPING_LABEL: 12, SALE_PLATFORM_FEE: 15, Storage: 25 });
    expect(data.count).toBe(7);
  });

  it('is the same set of lines the website\'s Expenses tab loads', async () => {
    const [manual, derived] = await Promise.all([
      fetch(`${baseUrl}/api/expenses`).then((r) => r.json()),
      fetch(`${baseUrl}/api/expenses/derived`).then((r) => r.json()),
    ]);
    const { data } = await callTool('list_all_costs', {});
    const webIds = [...(manual.expenses || manual).map((e) => e.id), ...derived.map((l) => l.id)].sort();
    expect(data.lines.map((l) => l.id).sort()).toEqual(webIds);
    const webTotal = [...(manual.expenses || manual), ...derived].reduce((sum, l) => sum + Number(l.amount), 0);
    expect(data.total).toBeCloseTo(webTotal, 2);
  });

  it('respects the date range, drops cancelled sales, and can return totals only', async () => {
    expect((await callTool('list_all_costs', { start_date: '2026-09-02', end_date: '2026-09-30' })).data.total).toBe(27);
    sale().status = 'CANCELLED';
    const { data } = await callTool('list_all_costs', { start_date: '2026-09-02', include_lines: false });
    expect(data.total).toBe(0);
    expect(data.lines).toBeUndefined();
    expect((await callTool('list_all_costs', { start_date: '2026-10-01', end_date: '2026-09-01' })).isError).toBe(true);
    expect(writes()).toEqual([]);
  });
});

describe('data_quality_report', () => {
  it('flags each kind of issue with the record ids', async () => {
    Object.assign(sale(), { workflow_status: 'PAID', tracking_number: '1ZTRACK' });
    const dupeTracking = addSale({ tracking_number: '1Z TRACK' });
    const noPlatform = addSale({ platform_id: null });
    const dupePurchase = addPurchase({ order_number: 'ORD-9' });
    const zeroCost = addPurchase({ product_name: 'Free thing', gift_card_amount: 1000, order_number: 'ORD-10', tracking_number: null });
    const contradicted = addSale({ workflow_status: 'PAID', paid_at: new Date('2026-10-01T12:00:00Z'), paid_amount: 100, notes: 'Payment not received yet!' });

    const { data } = await callTool('data_quality_report', {});
    const ids = (key) => data.issues[key].items.map((i) => i.id);
    expect(ids('purchases_missing_order_number')).toEqual([harness.ids.inventory]);
    expect(ids('purchases_missing_inbound_tracking')).toEqual([zeroCost]);
    expect(data.issues.sales_paid_without_payment.items).toEqual([expect.objectContaining({ id: harness.ids.sale, can_backfill: true })]);
    expect(ids('purchases_zero_cost')).toEqual([zeroCost]);
    expect(data.issues.duplicate_sale_tracking.items).toEqual([{ tracking_number: '1ZTRACK', sale_ids: [harness.ids.sale, dupeTracking] }]);
    expect(ids('sales_missing_platform')).toEqual([noPlatform]);
    expect(data.issues.possible_duplicate_purchases.items[0].purchase_ids).toEqual([harness.ids.inventory, dupePurchase]);
    expect(ids('notes_contradict_payment')).toEqual([contradicted]);
    expect(data.total_issues).toBe(Object.values(data.issues).reduce((sum, i) => sum + i.count, 0));
    expect(writes()).toEqual([]);
  });

  it('reads transaction notes too, and flags "paid" wording on an unpaid sale', async () => {
    harness.db.transactionNote.push({ id: 'cccccccc-0000-4000-8000-000000000002', user_id: harness.ids.user, entity_type: 'sale', entity_id: harness.ids.sale, body: 'Got paid via Zelle', deleted_at: null, created_at: new Date() });
    const { data } = await callTool('data_quality_report', { issues: ['notes_contradict_payment'] });
    expect(Object.keys(data.issues)).toEqual(['notes_contradict_payment']);
    expect(data.issues.notes_contradict_payment.items[0]).toMatchObject({ id: harness.ids.sale, payout_status: 'unpaid' });
  });

  it('leaves out cancelled records, caps items, and rejects an unknown issue key', async () => {
    inv().cancelled_at = new Date();
    const { data } = await callTool('data_quality_report', { max_items: 1 });
    expect(data.issues.purchases_missing_order_number.count).toBe(0);
    const bad = await callTool('data_quality_report', { issues: ['nope'] });
    expect(bad.isError).toBe(true);
    expect(bad.data).toContain('Unknown issue key');
  });
});

describe('match_deposit', () => {
  beforeEach(() => { sale().workflow_status = 'WAITING_FOR_PAYMENT'; });

  it('prefers the exact combination with the fewest sales', async () => {
    const a = addSale({ unit_price: 100 });
    const b = addSale({ unit_price: 173 });
    const { data } = await callTool('match_deposit', { amount: 273, date: '2026-10-08' });
    expect(data.exact[0].sale_ids).toEqual([harness.ids.sale]);
    expect(data.exact[1].sale_ids.sort()).toEqual([a, b].sort());
    expect(data.exact[0].difference).toBe(0);
    expect(data.closest).toEqual([]);
    expect(data.search_complete).toBe(true);
  });

  it('finds a multi-sale exact sum', async () => {
    const a = addSale({ unit_price: 100 });
    addSale({ unit_price: 40 });
    const { data } = await callTool('match_deposit', { amount: 373, date: '2026-10-08' });
    expect(data.exact).toHaveLength(1);
    expect(data.exact[0].sale_ids.sort()).toEqual([harness.ids.sale, a].sort());
    expect(data.exact[0].total).toBe(373);
  });

  it('returns the closest sums with the difference when nothing is exact', async () => {
    addSale({ unit_price: 100 });
    const { data } = await callTool('match_deposit', { amount: 370, date: '2026-10-08' });
    expect(data.exact).toEqual([]);
    expect(data.closest[0]).toMatchObject({ total: 373, difference: -3 });
  });

  it('leaves out sales sold after the deposit, not yet shipped, short-paid, or fully paid', async () => {
    addSale({ unit_price: 50, sale_date: new Date('2026-10-20T12:00:00Z') });
    addSale({ unit_price: 50, workflow_status: 'AWAITING_SHIPMENT' });
    addSale({ unit_price: 50, workflow_status: 'PAID', paid_at: new Date('2026-10-01T12:00:00Z'), paid_amount: 40, payout_short_amount: 10 });
    addSale({ unit_price: 50, workflow_status: 'PAID', paid_at: new Date('2026-10-01T12:00:00Z'), paid_amount: 50 });
    const backfill = addSale({ unit_price: 50, workflow_status: 'PAID' });
    const { data } = await callTool('match_deposit', { amount: 50, date: '2026-10-08' });
    expect(data.exact.map((c) => c.sale_ids)).toEqual([[backfill]]);
    expect(data.excluded).toEqual({ partial: 1, not_payable: 1 });
  });

  it('narrows by platform, and by the platforms that paid into an account before', async () => {
    const otherPlatform = '77777777-0000-4000-8000-000000000009';
    harness.db.platform.push({ id: otherPlatform, user_id: harness.ids.user, name: 'Windy City', type: 'Cashout' });
    const windy = addSale({ unit_price: 273, platform_id: otherPlatform });
    expect((await callTool('match_deposit', { amount: 273, date: '2026-10-08', platform: 'windy' })).data.exact.map((c) => c.sale_ids)).toEqual([[windy]]);
    addSale({ platform_id: otherPlatform, workflow_status: 'PAID', paid_at: new Date('2026-09-20T12:00:00Z'), paid_amount: 100, payout_account: 'Chase College' });
    const { data } = await callTool('match_deposit', { amount: 273, date: '2026-10-08', account: 'Chase College' });
    expect(data.exact.map((c) => c.sale_ids)).toEqual([[windy]]);
  });

  it('result ids work as-is in mark_sale_paid, and the search itself writes nothing', async () => {
    const { data } = await callTool('match_deposit', { amount: 273, date: '2026-10-08' });
    expect(writes()).toEqual([]);
    const paid = await callTool('mark_sale_paid', { sale_ids: data.exact[0].sale_ids, payout_date: '2026-10-08', payout_amount: 273 });
    expect(paid.data[0].payout_status).toBe('paid');
    // Proves writes() really sees writes, so the empty checks above mean something.
    expect(writes().length).toBeGreaterThan(0);
  });
});
