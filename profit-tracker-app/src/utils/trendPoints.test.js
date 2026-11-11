import { describe, it, expect } from 'vitest';
import { niceTicks, monotonePath, formatAxisLabel, formatLongLabel, toCumulative, normalizeTrendPoints, fillDailyWindow } from './trendPoints';

describe('trendPoints', () => {
  it('builds a 0..10,000 axis in $2,000 steps for the sample data', () => {
    expect(niceTicks(0, 9500, 5)).toEqual([0, 2000, 4000, 6000, 8000, 10000]);
  });

  it('extends below zero when a series goes negative', () => {
    const ticks = niceTicks(-300, 4000, 5);
    expect(ticks[0]).toBeLessThan(0);
    expect(ticks).toContain(0);
  });

  it('handles an all-zero dataset without dividing by zero', () => {
    const ticks = niceTicks(0, 0, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThan(0);
  });

  it('monotone path never overshoots flat neighbours', () => {
    const d = monotonePath([[0, 10], [10, 10], [20, 0], [30, 0]]);
    const ys = [...d.matchAll(/[ ,C]([\d.-]+),([\d.-]+)/g)].map(m => Number(m[2]));
    ys.forEach(y => { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(10); });
  });

  it('formats month labels with the year on the first point and January', () => {
    expect(formatAxisLabel('2025-08', 0)).toBe('Aug 25');
    expect(formatAxisLabel('2026-02', 3)).toBe('Feb');
    expect(formatAxisLabel('2026-01', 2)).toBe('Jan 26');
    expect(formatLongLabel('2026-03')).toBe('Mar 2026');
    expect(formatAxisLabel('2026-11-03', 1)).toBe('Nov 3');
  });

  it('accumulates running totals and fills empty days', () => {
    const pts = normalizeTrendPoints([{ date: '2026-11-01', totalRevenue: 5 }, { date: '2026-11-03', totalRevenue: '7' }]);
    expect(toCumulative(pts).map(p => p.totalRevenue)).toEqual([5, 12]);
    const filled = fillDailyWindow(pts, { windowStart: '2026-11-01', windowEnd: '2026-11-04' });
    expect(filled.map(p => p.totalRevenue)).toEqual([5, 0, 7, 0]);
  });
});
