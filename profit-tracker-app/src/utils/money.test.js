import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('adds thousands separators and two decimals', () => {
    expect(formatMoney(23097.2)).toBe('23,097.20');
    expect(formatMoney(1000000)).toBe('1,000,000.00');
    expect(formatMoney(12.5)).toBe('12.50');
    expect(formatMoney(0)).toBe('0.00');
  });

  it('keeps a negative sign', () => {
    expect(formatMoney(-1234.5)).toBe('-1,234.50');
  });

  it('accepts numeric strings and shows 0.00 for anything else', () => {
    expect(formatMoney('1234.5')).toBe('1,234.50');
    expect(formatMoney(null)).toBe('0.00');
    expect(formatMoney(undefined)).toBe('0.00');
    expect(formatMoney('abc')).toBe('0.00');
    expect(formatMoney(NaN)).toBe('0.00');
  });
});
