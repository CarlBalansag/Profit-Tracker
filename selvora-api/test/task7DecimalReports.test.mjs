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

const get = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
};

// At most 2 decimal places (or a clean integer) -- catches any residual
// float leakage into a response that's supposed to be exact-by-construction.
function assertCleanMoney(value, label) {
  expect(Number.isFinite(value), `${label} should be a finite number`).toBe(true);
  const rounded = Math.round(value * 100) / 100;
  expect(value, `${label} (${value}) should already be rounded to 2 decimal places`).toBeCloseTo(rounded, 10);
}

describe('currency migration Task 7: exact-by-construction report totals', () => {
  it('/api/analytics/dashboard returns cleanly-rounded stats, trend, and card totals even with many accumulated rows', async () => {
    // Seed several extra inventory rows whose batch cost * cashback rate
    // produces raw float noise past 2 decimals (the exact Inventory.cashback_earned
    // drift class the Task 3 audit found), to prove the *aggregate* the route
    // returns doesn't inherit that noise.
    const extra = [
      { cost: 216.63, rate: 2.5 },
      { cost: 64.2, rate: 1 },
      { cost: 8.97, rate: 5 },
    ];
    extra.forEach((row, i) => {
      harness.db.paymentMethod.push({
        id: `noise-card-${i}`, user_id: harness.ids.user, name: `Noise Card ${i}`,
        type: 'Credit', default_cashback_rate: row.rate, category_rates: '[]',
      });
      harness.db.inventory.push({
        id: `noise-inv-${i}`, user_id: harness.ids.user, product_name: `Noise Item ${i}`,
        vendor_id: harness.ids.vendor, payment_method_id: `noise-card-${i}`,
        unit_purchase_cost: row.cost, qty_purchased: 1, qty_on_hand: 1,
        sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0,
        cashback_earned: 0, status: 'PURCHASED', purchase_date: new Date('2026-09-05T12:00:00Z'), created_at: new Date(),
      });
    });

    const res = await get('/api/analytics/dashboard');
    expect(res.status).toBe(200);

    assertCleanMoney(res.body.stats.totalCost, 'stats.totalCost');
    assertCleanMoney(res.body.stats.totalCashback, 'stats.totalCashback');
    assertCleanMoney(res.body.stats.soldCost, 'stats.soldCost');
    assertCleanMoney(res.body.stats.totalRevenue, 'stats.totalRevenue');
    assertCleanMoney(res.body.stats.profit, 'stats.profit');
    assertCleanMoney(res.body.stats.inventoryValue, 'stats.inventoryValue');
    res.body.topCards.forEach(card => assertCleanMoney(card.amount, `topCards[${card.name}].amount`));
    res.body.trend.forEach(pt => {
      assertCleanMoney(pt.totalCost, `trend[${pt.date}].totalCost`);
      assertCleanMoney(pt.cashback, `trend[${pt.date}].cashback`);
    });
    res.body.cashFlowTransactions.forEach(tx => {
      assertCleanMoney(tx.cost, `cashFlowTransactions[${tx.id}].cost`);
      assertCleanMoney(tx.cashback, `cashFlowTransactions[${tx.id}].cashback`);
      assertCleanMoney(tx.profit, `cashFlowTransactions[${tx.id}].profit`);
    });
  });

  it('/api/creditcard/dashboard returns cleanly-rounded card and summary totals', async () => {
    const res = await get('/api/creditcard/dashboard?month=2026-09');
    expect(res.status).toBe(200);

    res.body.cards.forEach(card => {
      assertCleanMoney(card.totalSpend, `cards[${card.name}].totalSpend`);
      assertCleanMoney(card.cashbackEarned, `cards[${card.name}].cashbackEarned`);
      assertCleanMoney(card.amountToPay, `cards[${card.name}].amountToPay`);
      card.items.forEach(item => {
        assertCleanMoney(item.cost, `item[${item.id}].cost`);
        assertCleanMoney(item.cashback, `item[${item.id}].cashback`);
      });
    });
    Object.entries(res.body.summary).forEach(([key, value]) => assertCleanMoney(value, `summary.${key}`));
  });

  it('/api/receipts returns a cleanly-rounded amount for each inventory item', async () => {
    const res = await get('/api/receipts');
    expect(res.status).toBe(200);
    [...res.body.withReceipts, ...res.body.withoutReceipts].forEach(item => assertCleanMoney(item.amount, `item[${item.id}].amount`));
  });
});
