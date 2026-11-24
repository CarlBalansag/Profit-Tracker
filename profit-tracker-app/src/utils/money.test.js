import { describe, expect, it } from 'vitest';
import { formatMoney, formatWholeMoney } from './money';

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

describe('formatWholeMoney', () => {
  it('rounds to whole dollars with thousands separators', () => {
    expect(formatWholeMoney(23097.2)).toBe('23,097');
    expect(formatWholeMoney(999.5)).toBe('1,000');
    expect(formatWholeMoney(0)).toBe('0');
    expect(formatWholeMoney(-1234.4)).toBe('-1,234');
  });

  it('shows 0 for anything that is not a number', () => {
    expect(formatWholeMoney(null)).toBe('0');
    expect(formatWholeMoney('abc')).toBe('0');
  });
});

describe('dollars with the sign in front', () => {
  it('puts a minus before the $ instead of after it', async () => {
    const { formatDollars, formatSignedDollars, formatWholeDollars } = await import('./money');
    expect(formatDollars(-1234.5)).toBe('-$1,234.50');
    expect(formatDollars(5)).toBe('$5.00');
    expect(formatDollars(0)).toBe('$0.00');
    expect(formatDollars('abc')).toBe('$0.00');
    expect(formatSignedDollars(5)).toBe('+$5.00');
    expect(formatSignedDollars(0)).toBe('+$0.00');
    expect(formatSignedDollars(-5)).toBe('-$5.00');
    expect(formatSignedDollars(null)).toBe('+$0.00');
    expect(formatWholeDollars(-1234.4)).toBe('-$1,234');
    expect(formatWholeDollars(999.5)).toBe('$1,000');
    expect(formatWholeDollars(-0.2)).toBe('$0');
  });
});
