// Phase 5 (expenses): suggested tax details for the review queue, and
// duplicates between manual expenses on the Schedule C worksheet.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { suggestTaxCategory, suggestTaxDetails, emptyTaxDetails } from '../../shared/scheduleC.mjs';

const require = createRequire(import.meta.url);
const { expenseWorksheet } = require('../services/scheduleC');

describe('suggestTaxCategory', () => {
  it('maps the expense category first, then whole words in the name', () => {
    expect(suggestTaxCategory({ category: 'SHIPPING_SUPPLIES', name: 'Facebook ads' }).tax_category).toBe('SUPPLIES');
    expect(suggestTaxCategory({ category: 'PROXY' }).tax_category).toBe('SOFTWARE');
    expect(suggestTaxCategory({ category: 'CREDIT_CARD_FEE' }).tax_category).toBe('OTHER');
    expect(suggestTaxCategory({ category: 'OTHER', name: 'Pirate Ship labels' })).toEqual({ tax_category: 'POSTAGE', reason: 'Suggested because the name mentions "labels".' });
    expect(suggestTaxCategory({ name: 'Stamps.com monthly' }).tax_category).toBe('POSTAGE');
    expect(suggestTaxCategory({ name: 'CPA tax prep' }).tax_category).toBe('PROFESSIONAL');
    // Parts of words don't count: "Loading dock" isn't advertising, "Boxing gloves" aren't boxes.
    expect(suggestTaxCategory({ name: 'Loading dock rental' })).toBeNull();
    expect(suggestTaxCategory({ name: 'Boxing gloves' })).toBeNull();
    expect(suggestTaxCategory({})).toBeNull();
  });
});

describe('suggestTaxDetails', () => {
  const expense = { name: 'Uline boxes', category: 'SHIPPING_SUPPLIES', date: '2026-03-04T12:00:00Z' };
  it('fills every blank field, using the card it was paid with as evidence', () => {
    expect(suggestTaxDetails(expense, { paymentMethodName: 'Chase Ink' })).toEqual({
      reason: 'Suggested because its expense category is Shipping Supplies.',
      fields: { tax_category: 'SUPPLIES', business_use: 'business', payee: 'Uline boxes', purpose: 'Packing and shipping supplies for orders', payment_status: 'paid', paid_date: '2026-03-04', payment_reference: 'Paid with Chase Ink on 2026-03-04' },
    });
  });
  it('never touches what the user already filled, and doesn\'t assume payment without a card', () => {
    const tax = { ...emptyTaxDetails(), payee: 'Uline', business_use: 'mixed', business_percent: '50', tax_category: 'OFFICE' };
    const s = suggestTaxDetails({ ...expense, tax_details: tax });
    expect(s.fields).toEqual({ purpose: 'Office supplies used for the business' });
    expect(suggestTaxDetails({ name: 'zz' })).toEqual({ fields: { business_use: 'business', payee: 'zz' }, reason: null });
  });
});

describe('duplicate manual expenses', () => {
  const exp = (id, name, amount, date, extra = {}) => ({ id, name, amount, date: new Date(`${date}T12:00:00Z`), tax_details: null, ...extra });
  const flagged = async (expenses) => (await expenseWorksheet(expenses, 2026)).rows.filter((r) => r.possible_duplicate_of).map((r) => [r.id, r.possible_duplicate_source, r.possible_duplicate_id]);

  it('flags the later of two same-amount charges a day apart with matching names', async () => {
    expect(await flagged([exp('a', 'Canva Pro', 14.99, '2026-03-01'), exp('b', 'Canva Pro subscription', 14.99, '2026-03-02')])).toEqual([['b', 'expense', 'a']]);
    const ws = await expenseWorksheet([exp('a', 'Canva', 10, '2026-03-01'), exp('b', 'canva', 10, '2026-03-01')], 2026);
    expect([ws.possible_duplicates, ws.possible_duplicates_of_expenses, ws.possible_duplicates_of_sales]).toEqual([1, 1, 0]);
  });

  it('leaves different amounts, names, days or imported transactions alone', async () => {
    expect(await flagged([
      exp('a', 'Canva', 10, '2026-03-01'), exp('b', 'Canva', 10.01, '2026-03-01'), // amount
      exp('c', 'Adobe', 20, '2026-03-05'), exp('d', 'Canva', 20, '2026-03-05'), // name
      exp('e', 'Uline', 30, '2026-03-10'), exp('f', 'Uline', 30, '2026-03-12'), // more than a day
      exp('g', 'Netflix', 15, '2026-04-01', { external_id: 'tx-1' }), exp('h', 'Netflix', 15, '2026-04-01', { external_id: 'tx-2' }), // two statement lines
    ])).toEqual([]);
    // Personal (excluded) expenses don't count.
    const personal = { ...emptyTaxDetails(), business_use: 'personal' };
    expect(await flagged([exp('a', 'Canva', 10, '2026-03-01', { tax_details: personal }), exp('b', 'Canva', 10, '2026-03-01')])).toEqual([]);
  });
});

describe('worksheet suggestions over the API', () => {
  const harness = require('../../qa/harness.cjs');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });

  it('sends a suggestion for each expense waiting for review, with the card name only', async () => {
    harness.db.expense.push({ id: 'exp-labels', user_id: harness.ids.user, name: 'Pirate Ship labels', amount: 12.5, date: new Date('2026-05-02T12:00:00Z'), category: 'OTHER', payment_method_id: harness.ids.card, tax_version: 0 });
    const body = await (await fetch(`${base}/api/schedule-c?year=2026`)).json();
    const row = body.rows.find((r) => r.id === 'exp-labels');
    expect(row.status).toBe('pending');
    expect(row.payment_method_name).toBe('QA Credit Card');
    expect(row).not.toHaveProperty('payment_method');
    expect(row.suggestion.fields).toMatchObject({ tax_category: 'POSTAGE', payment_status: 'paid', paid_date: '2026-05-02', payment_reference: 'Paid with QA Credit Card on 2026-05-02' });
    // Accepting it (with the user's save) makes it reviewed, with no suggestion left.
    const tax = { ...emptyTaxDetails(), ...row.suggestion.fields, reviewed: true };
    const save = await fetch(`${base}/api/expenses/exp-labels`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tax_details: tax, expected_tax_version: 0 }) });
    expect(save.status).toBe(200);
    const after = (await (await fetch(`${base}/api/schedule-c?year=2026`)).json()).rows.find((r) => r.id === 'exp-labels');
    expect([after.status, after.suggestion, after.eligible]).toEqual(['reviewed', null, '12.50']);
  });
});
