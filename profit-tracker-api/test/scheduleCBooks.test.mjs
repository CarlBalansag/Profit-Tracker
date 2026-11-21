// Schedule C Parts I and III from purchases and sales. Amounts are worked by
// hand from the fixtures below.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scheduleCBooks } = require('../services/scheduleCBooks');

const sale = (over) => ({ id: 's', quantity: 1, unit_price: 0, commission_fee: 0, sale_shipping: 0, refunded_amount: 0, refunded_qty: 0, restored_qty: 0, status: 'SOLD', platform: { name: 'eBay' }, paid_at: null, sale_tax_collected: 0, ...over });
// 4 units x $50 + $20 tax + $8 inbound shipping + $2 fees = $230 -> $57.50 a unit.
const batchA = (sales) => ({ id: 'A', product_name: 'Console', purchase_date: '2025-11-10T12:00:00Z', unit_purchase_cost: 50, qty_purchased: 4, sales_tax: 20, shipping_cost_inbound: 8, fees: 2, gift_card_amount: 0, refunded_amount: 0, refunded_qty: 0, cashback_rate: 0, cashback_earned: 0, sales });
// 2 units x $10 with $1.00 of card rewards -> $19 tax cost, $9.50 a unit.
const batchB = (sales) => ({ id: 'B', product_name: 'Cable', purchase_date: '2026-02-20T12:00:00Z', unit_purchase_cost: 10, qty_purchased: 2, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, refunded_amount: 0, refunded_qty: 0, cashback_rate: 5, cashback_earned: 1, sales });
const salesA = () => [
  sale({ id: 'a1', unit_price: 100, sale_date: '2025-12-01T12:00:00Z', paid_at: '2025-12-04T12:00:00Z' }),
  sale({ id: 'a2', quantity: 2, unit_price: 90, sale_date: '2026-02-01T12:00:00Z', paid_at: '2026-02-03T12:00:00Z', platform: { name: 'StockX' } }),
];
const salesB = () => [sale({ id: 'b1', unit_price: 25, commission_fee: 3, sale_shipping: 4, sale_date: '2026-03-01T12:00:00Z', paid_at: '2026-03-02T12:00:00Z' })];
const worksheet = (over = {}) => ({ returns_and_allowances: { total: '0.00' }, total: '0.00', automatic: { total: '0.00' }, rows: [], ...over });
const line = (books, n) => books.lines.find((l) => l.line === n).amount;
const part3 = (books, n) => books.partIII.find((l) => l.line === n).amount;

describe('Schedule C books', () => {
  it('builds Parts I and III across two years with inventory carried forward', () => {
    const y2025 = scheduleCBooks({ inventories: [batchA(salesA())], year: 2025, worksheet: worksheet() });
    expect(line(y2025, '1')).toBe('100.00');
    expect([part3(y2025, '35'), part3(y2025, '36'), part3(y2025, '41'), part3(y2025, '42')]).toEqual(['0.00', '230.00', '172.50', '57.50']);
    expect(y2025.netProfit).toBe('42.50');

    const inventories = [batchA(salesA()), batchB(salesB())];
    const y2026 = scheduleCBooks({ inventories, year: 2026, worksheet: worksheet({ total: '7.00', automatic: { total: '7.00' } }) });
    expect(line(y2026, '1')).toBe('205.00');
    // 172.50 + 19.00 - (57.50 + 9.50) = 124.50
    expect([part3(y2026, '35'), part3(y2026, '36'), part3(y2026, '41'), part3(y2026, '42')]).toEqual(['172.50', '19.00', '67.00', '124.50']);
    expect(line(y2026, '4')).toBe('124.50');
    expect(line(y2026, '31')).toBe('73.50'); // 205 - 124.50 - 7
    expect(y2026.checks.directCostOfUnitsSold).toBe('124.50');
    expect(y2026.sales.byPlatform).toEqual([{ platform: 'StockX', gross: '180.00', count: 1 }, { platform: 'eBay', gross: '25.00', count: 1 }]);
  });

  it('matches app profit when nothing differs, and every difference adds up to line 31', () => {
    const y = scheduleCBooks({ inventories: [batchA(salesA()), batchB(salesB())], year: 2026, worksheet: worksheet({ total: '7.00', automatic: { total: '7.00' } }) });
    expect(y.reconciliation.appProfitOnSales).toBe('73.50');
    expect(y.reconciliation.differences.map((d) => d.amount)).toEqual(['0.00', '0.00', '0.00']);

    // A $20 refund paid in 2027 on a 2026 sale: the app nets it now, Schedule C later.
    const refunded = salesA(); refunded[1].refunded_amount = 20;
    const r = scheduleCBooks({ inventories: [batchA(refunded)], year: 2026, worksheet: worksheet(), expensesInYear: [{ amount: 12 }] });
    const sum = Number(r.reconciliation.appProfitAfterExpenses) + r.reconciliation.differences.reduce((s, d) => s + Number(d.amount), 0);
    expect(Math.round(sum * 100) / 100).toBe(Number(r.netProfit));
    expect(r.reconciliation.differences.find((d) => d.key === 'refund_timing').amount).toBe('20.00');
    expect(r.reconciliation.differences.find((d) => d.key === 'expenses').amount).toBe('12.00');
  });

  it('leaves out cancelled purchases and cancelled, returned or disputed sales', () => {
    const cancelled = { ...batchB(salesB()), cancelled_at: '2026-02-21T12:00:00Z' };
    const sales = salesA(); sales[1].status = 'RETURNED';
    const y = scheduleCBooks({ inventories: [batchA(sales), cancelled], year: 2026, worksheet: worksheet() });
    expect(line(y, '1')).toBe('0.00');
    expect(part3(y, '36')).toBe('0.00');
    expect(part3(y, '41')).toBe('172.50'); // the returned units never left inventory
    expect(line(y, '4')).toBe('0.00');
  });

  it('only costs units a sale still keeps out of stock', () => {
    const sales = salesA(); sales[1].restored_qty = 1; // one of two units put back
    const y = scheduleCBooks({ inventories: [batchA(sales)], year: 2026, worksheet: worksheet() });
    expect(line(y, '4')).toBe('57.50');
    expect(part3(y, '41')).toBe('115.00');
    expect(y.checks.salesWithRestoredUnits).toBe(1);
  });

  it('uses refunded units and store refunds in the unit cost', () => {
    // $30 store refund and 1 unit sent back: ($230 - $30) / 3 units = $66.67 a unit.
    const inv = { ...batchA([sale({ id: 'x', unit_price: 120, sale_date: '2025-12-10T12:00:00Z', paid_at: '2025-12-11T12:00:00Z' })]), refunded_amount: 30, refunded_qty: 1 };
    const y = scheduleCBooks({ inventories: [inv], year: 2025, worksheet: worksheet() });
    expect(part3(y, '36')).toBe('200.00');
    expect(part3(y, '41')).toBe('133.33');
    expect(line(y, '4')).toBe('66.67');
  });

  it('flags data problems instead of hiding them', () => {
    const oversold = batchA([sale({ id: 'o', quantity: 5, unit_price: 10, sale_date: '2025-12-01T12:00:00Z' })]);
    const early = batchB([sale({ id: 'e', unit_price: 10, sale_date: '2026-01-05T12:00:00Z' })]);
    const y = scheduleCBooks({ inventories: [oversold, early], year: 2026, worksheet: worksheet() });
    expect(y.checks.oversold.map((o) => o.inventory_id)).toEqual(['A']);
    expect(y.checks.soldBeforePurchase.map((s) => s.sale_id)).toEqual(['e']);
  });

  it('lists late-December sales paid next year for the cutoff check', () => {
    const late = batchA([
      sale({ id: 'late', unit_price: 80, sale_date: '2025-12-28T12:00:00Z', paid_at: '2026-01-03T12:00:00Z' }),
      sale({ id: 'unpaid', unit_price: 60, sale_date: '2025-12-30T12:00:00Z' }),
      sale({ id: 'paid', unit_price: 40, sale_date: '2025-12-27T12:00:00Z', paid_at: '2025-12-29T12:00:00Z' }),
    ]);
    const y = scheduleCBooks({ inventories: [late], year: 2025, worksheet: worksheet() });
    expect(y.yearEndCutoff.sales.map((s) => s.sale_id)).toEqual(['late', 'unpaid']);
    expect(y.yearEndCutoff.total).toBe('140.00');
  });

  it('explains gift cards, sales tax, card rewards, missing history and pending expenses', () => {
    const inv = { ...batchB([sale({ id: 't', unit_price: 25, sale_tax_collected: 2, sale_date: '2026-03-01T12:00:00Z' })]), gift_card_amount: 5 };
    const y = scheduleCBooks({ inventories: [inv], year: 2026, worksheet: worksheet({ rows: [{ status: 'pending' }] }) });
    const text = y.notes.join(' ');
    expect(text).toMatch(/Gift cards paid \$5\.00/);
    expect(text).toMatch(/Sales tax you recorded collecting \(\$2\.00\)/);
    expect(text).toMatch(/Card rewards on this year's purchases/);
    expect(text).toMatch(/no purchases from before 2026/);
    expect(text).toMatch(/1 expense is waiting for review/);
    expect(line(y, '1')).toBe('25.00'); // tax collected stays out of gross receipts
  });

  it('is all zeros with no records', () => {
    const y = scheduleCBooks({ inventories: [], year: 2026, worksheet: worksheet() });
    expect(y.lines.every((l) => l.amount === '0.00')).toBe(true);
    expect(y.sales.count).toBe(0);
  });
});

describe('GET /api/schedule-c books', () => {
  const harness = require('../../qa/harness.cjs');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });

  it('returns Parts I and III alongside the Part II worksheet, adding up', async () => {
    const body = await (await fetch(`${base}/api/schedule-c?year=2026`)).json();
    expect(body.groups).toBeDefined();
    const { books } = body;
    expect(books.lines.map((l) => l.line)).toEqual(['1', '2', '3', '4', '5', '6', '7', '28', '29', '30', '31']);
    const gross = books.sales.byPlatform.reduce((s, p) => s + Number(p.gross), 0);
    expect(Number(books.lines[0].amount)).toBeCloseTo(gross, 2);
    expect(books.lines.find((l) => l.line === '28').amount).toBe(body.total);
    const sum = Number(books.reconciliation.appProfitAfterExpenses) + books.reconciliation.differences.reduce((s, d) => s + Number(d.amount), 0);
    expect(sum).toBeCloseTo(Number(books.netProfit), 2);
  });
});
