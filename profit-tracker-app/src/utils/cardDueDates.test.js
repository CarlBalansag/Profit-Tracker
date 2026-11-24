import { describe, expect, it } from 'vitest';
import { daysUntilDue, dueDateLabel } from './cardDueDates';

const at = (y, m, d, h = 14) => new Date(y, m - 1, d, h);

describe('card due dates', () => {
  it('counts whole days, whatever the time of day', () => {
    expect(daysUntilDue(27, at(2026, 11, 24, 0))).toBe(3);
    expect(daysUntilDue(27, at(2026, 11, 24, 23))).toBe(3);
  });
  it('stays due today until midnight, then moves to next month', () => {
    expect(daysUntilDue(24, at(2026, 11, 24, 23))).toBe(0);
    expect(dueDateLabel(24, at(2026, 11, 24))).toBe('Nov 24');
    expect(daysUntilDue(24, at(2026, 11, 25))).toBe(29);
  });
  it('puts a day past the end of the month on its last day', () => {
    expect(dueDateLabel(31, at(2026, 11, 10))).toBe('Nov 30');
    expect(dueDateLabel(31, at(2027, 2, 1))).toBe('Feb 28');
  });
  it('crosses the year end and a daylight-saving change', () => {
    expect(daysUntilDue(2, at(2026, 12, 31))).toBe(2);
    expect(daysUntilDue(2, at(2026, 10, 31))).toBe(2);
  });
  it('has no date without a due day', () => {
    expect(daysUntilDue(null)).toBeNull();
    expect(dueDateLabel(undefined)).toBeNull();
  });
});
