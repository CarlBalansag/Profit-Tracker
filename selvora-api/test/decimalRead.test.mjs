import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Prisma } = require('@prisma/client');
const { withExactFields, withExactList, MAPPINGS } = require('../services/decimalRead.js');

describe('decimalRead: Task 8 read cutover', () => {
  it('substitutes the decimal value into the float field name and drops the raw _decimal key', () => {
    const record = {
      id: '1',
      unit_purchase_cost: 5.4158, // stale/imprecise float value
      unit_purchase_cost_decimal: new Prisma.Decimal('5.42'),
    };
    const result = withExactFields(record, MAPPINGS.inventory);
    expect(result.unit_purchase_cost).toBe(5.42);
    expect(result).not.toHaveProperty('unit_purchase_cost_decimal');
    expect(result.id).toBe('1');
  });

  it('leaves the original float value in place when the decimal mirror is null (e.g. a unitsSold goal target)', () => {
    const record = { id: 'g1', metric: 'unitsSold', target_30d: 10, target_30d_decimal: null };
    const result = withExactFields(record, MAPPINGS.goal);
    expect(result.target_30d).toBe(10);
    expect(result).not.toHaveProperty('target_30d_decimal');
  });

  it('applies across a list of records', () => {
    const records = [
      { id: '1', amount: 12.999, amount_decimal: new Prisma.Decimal('13.00') },
      { id: '2', amount: 0.1, amount_decimal: new Prisma.Decimal('0.10') },
    ];
    const result = withExactList(records, MAPPINGS.expense);
    expect(result.map(r => r.amount)).toEqual([13, 0.1]);
  });

  it('returns a plain JSON number, not a string, after JSON round-trip', () => {
    const record = { fee_pct: 0, fee_pct_decimal: new Prisma.Decimal('0') };
    const result = withExactFields(record, MAPPINGS.platform);
    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(typeof roundTripped.fee_pct).toBe('number');
  });

  it('is a no-op when the decimal field is not present in the record (e.g. a select that omitted it)', () => {
    const record = { id: '1', unit_purchase_cost: 100 };
    const result = withExactFields(record, MAPPINGS.inventory);
    expect(result.unit_purchase_cost).toBe(100);
  });
});
