import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DISPLAY_LABELS,
  INVENTORY_RECEIVING_STATUSES,
  SALE_STATUSES_BY_WORKFLOW,
  SALE_EXCEPTION_STATUSES,
  SALE_WORKFLOW_TYPES,
  SALE_WORKFLOW_LABELS,
  STATUS_ORDER,
  displayLabel,
  availabilityLabel,
  correctableSaleStatuses,
  relativeTime,
  workflowLabel,
} from './statusWorkflow';

// The browser cannot import the API's CommonJS registry, so statusWorkflow.js
// restates its vocabulary. This suite loads the real registry in Node and
// asserts the two agree, so a server-side rename fails here instead of quietly
// rendering a raw constant to the user.
const require = createRequire(import.meta.url);
const registry = require('../../../selvora-api/services/statusTransitions.js');

describe('statusWorkflow mirrors the API status registry', () => {
  it('has exactly the registry display labels', () => {
    expect(DISPLAY_LABELS).toEqual(registry.DISPLAY_LABELS);
  });

  it('has the same inventory receiving statuses', () => {
    expect(INVENTORY_RECEIVING_STATUSES).toEqual(registry.INVENTORY_RECEIVING_STATUSES);
  });

  it('has the same sale workflow paths and exception statuses', () => {
    expect(SALE_STATUSES_BY_WORKFLOW).toEqual(registry.SALE_STATUSES_BY_WORKFLOW);
    expect(SALE_EXCEPTION_STATUSES).toEqual(registry.SALE_EXCEPTION_STATUSES);
  });

  // The workflow-type dropdown on the "set a status" form is built from this
  // list, and the server validates the chosen value against the registry's own,
  // so an option missing here is unreachable and an extra one is a guaranteed 400.
  it('has the same sale workflow types, each with a readable label', () => {
    expect(SALE_WORKFLOW_TYPES).toEqual(registry.SALE_WORKFLOW_TYPES);
    for (const type of SALE_WORKFLOW_TYPES) {
      expect(SALE_WORKFLOW_LABELS[type], type).toBeTruthy();
      expect(workflowLabel(type), type).not.toBe(type);
    }
    expect(Object.keys(SALE_WORKFLOW_LABELS).sort()).toEqual([...SALE_WORKFLOW_TYPES].sort());
    expect(workflowLabel(undefined)).toBe('');
  });

  it('orders every known status exactly once, with no unknown keys', () => {
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
    expect([...STATUS_ORDER].sort()).toEqual(Object.keys(registry.DISPLAY_LABELS).sort());
  });

  it('labels a status the same way the registry does, and falls back readably', () => {
    for (const status of STATUS_ORDER) expect(displayLabel(status)).toBe(registry.displayLabel(status));
    expect(displayLabel(null)).toBe('No status yet');
  });

  it('derives availability from quantity on hand, not a stored status', () => {
    expect(availabilityLabel({ qty_on_hand: 3 })).toBe('Available');
    expect(availabilityLabel({ qty_on_hand: 0 })).toBe('Sold Out');
    expect(availabilityLabel({})).toBe('Sold Out');
  });

});

// `relativeTime` formats receiving_status_changed_at / workflow_status_changed_at
// for the Statuses board. It is deliberately relative rather than an absolute
// calendar date for anything under a week: a date-only value rendered through
// toLocaleDateString can land on the wrong local day (the app's known UTC-midnight
// bug), and "when did this last move?" is the question a board card is answering.
describe('relativeTime', () => {
  const NOW = new Date('2026-10-03T15:30:00.000Z');
  const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const at = (now = NOW) => { vi.useFakeTimers(); vi.setSystemTime(now); };
  afterEach(() => vi.useRealTimers());

  it('renders nothing at all for a missing or unusable timestamp', () => {
    at();
    // A record with no stamp must show no timestamp -- never "just now", never
    // an empty-looking date.
    for (const absent of [null, undefined, '', 0, false, NaN]) {
      expect(relativeTime(absent), String(absent)).toBe('');
    }
    expect(relativeTime('not a date')).toBe('');
    expect(relativeTime(new Date('nonsense'))).toBe('');
  });

  it('says "just now" for anything under a minute old', () => {
    at();
    expect(relativeTime(ago(0))).toBe('just now');
    expect(relativeTime(ago(30 * 1000))).toBe('just now');
    expect(relativeTime(ago(MINUTE - 1))).toBe('just now');
    // A timestamp slightly in the future (server/browser clock skew) reads as
    // the newest bucket rather than a negative age.
    expect(relativeTime(new Date(NOW.getTime() + 5 * MINUTE).toISOString())).toBe('just now');
  });

  it('counts whole minutes from one minute up to the hour', () => {
    at();
    expect(relativeTime(ago(MINUTE))).toBe('1m ago');
    expect(relativeTime(ago(45 * MINUTE))).toBe('45m ago');
    expect(relativeTime(ago(HOUR - 1))).toBe('59m ago');
  });

  it('counts whole hours from one hour up to the day', () => {
    at();
    expect(relativeTime(ago(HOUR))).toBe('1h ago');
    expect(relativeTime(ago(5 * HOUR + 30 * MINUTE))).toBe('5h ago');
    expect(relativeTime(ago(DAY - 1))).toBe('23h ago');
  });

  it('counts whole days from one day up to a week', () => {
    at();
    expect(relativeTime(ago(DAY))).toBe('1d ago');
    expect(relativeTime(ago(3 * DAY))).toBe('3d ago');
    expect(relativeTime(ago(7 * DAY - 1))).toBe('6d ago');
  });

  it('falls back to a short absolute date once past a week', () => {
    at();
    for (const age of [7 * DAY, 30 * DAY, 400 * DAY]) {
      const formatted = relativeTime(ago(age));
      // "Sep 26" shape: a month abbreviation and a day number, never an age.
      expect(formatted, String(age)).toMatch(/^[A-Z][a-z]{2}\.? \d{1,2}$/);
      expect(formatted, String(age)).not.toMatch(/ago|just now/);
    }
  });

  it('accepts a Date as well as an ISO string', () => {
    at();
    expect(relativeTime(new Date(NOW.getTime() - 2 * HOUR))).toBe('2h ago');
  });

  // No module-level state: the answer depends only on the clock at call time, so
  // the same stamp ages as the page stays open.
  it('re-reads the clock on every call rather than capturing it once', () => {
    const stamp = ago(0);
    at();
    expect(relativeTime(stamp)).toBe('just now');
    vi.setSystemTime(new Date(NOW.getTime() + 3 * HOUR));
    expect(relativeTime(stamp)).toBe('3h ago');
  });
});

describe('statusWorkflow correction lists', () => {
  it('offers only a sale workflow\'s own path plus the exceptions as corrections', () => {
    expect(correctableSaleStatuses('DIRECT_LOCAL')).toEqual([
      ...registry.SALE_STATUSES_BY_WORKFLOW.DIRECT_LOCAL,
      ...registry.SALE_EXCEPTION_STATUSES,
    ]);
    // An unknown or missing workflow type falls back to the standard path, the
    // same way the registry's saleWorkflowOf does.
    expect(correctableSaleStatuses(undefined)).toEqual([
      ...registry.SALE_STATUSES_BY_WORKFLOW.STANDARD_MARKETPLACE,
      ...registry.SALE_EXCEPTION_STATUSES,
    ]);
  });
});
