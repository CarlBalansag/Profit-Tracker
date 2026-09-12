import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { parseAmount, moneyString, add, subtract, multiply, allocate } = createRequire(import.meta.url)('../services/money.js');
describe('exact currency utilities', () => {
  it('adds, subtracts and multiplies common decimal currency without float drift', () => {
    expect(add('0.1', '0.2').toString()).toBe('0.3');
    expect(subtract('1.00', '0.90').toString()).toBe('0.1');
    expect(multiply('0.29', 100).toString()).toBe('29');
    expect(moneyString(add(multiply('100.01', 3), '2.34', '0.56', '-10.00'))).toBe('292.93');
  });
  it('rounds positive and negative half cents away from zero', () => {
    expect(moneyString('1.005')).toBe('1.01');
    expect(moneyString('-1.005')).toBe('-1.01');
  });
  it('distributes residual cents across successive units and partial sales', () => {
    expect([0, 1, 2].map(offset => allocate('10', 1, 3, offset).toFixed(2))).toEqual(['3.33', '3.34', '3.33']);
    expect(add(allocate('10', 1, 3), allocate('10', 2, 3, 1)).toFixed(2)).toBe('10.00');
    expect(allocate('10', 0, 3).toFixed(2)).toBe('0.00');
    expect(() => allocate('10', 4, 3)).toThrow('quantities');
  });
  it('rejects malformed, excessive, non-finite, negative and over-precision money', () => {
    for (const value of ['', '1e2', 'abc', null, true, NaN, Infinity, '-0.01', '0.001', '1000000000000']) expect(() => parseAmount(value)).toThrow();
    expect(parseAmount('001.2300').toString()).toBe('1.23');
    expect(parseAmount('999999999999.99').toFixed(2)).toBe('999999999999.99');
  });
  it('keeps six fractional rate digits and bounds percentages', () => {
    expect(parseAmount('2.123456', 6).toString()).toBe('2.123456');
    expect(() => parseAmount('2.1234567', 6)).toThrow('6 decimal');
    expect(() => parseAmount('100.000001', 6)).toThrow('limit');
  });
});
