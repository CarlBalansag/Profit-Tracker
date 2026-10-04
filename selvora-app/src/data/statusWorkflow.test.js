import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
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
  formatStatusChangedAt,
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

// `formatStatusChangedAt` formats receiving_status_changed_at /
// workflow_status_changed_at for the Statuses board, as a calendar date (not an
// age): the field is a real timestamp with a real time of day, not a bare
// date-only value, so converting it to the viewer's local date does not hit the
// app's known, separate UTC-midnight day-rollover bug.
describe('formatStatusChangedAt', () => {
  it('renders nothing at all for a missing or unusable timestamp', () => {
    // A record with no stamp must show no date -- never a fake one.
    for (const absent of [null, undefined, '', 0, false, NaN]) {
      expect(formatStatusChangedAt(absent), String(absent)).toBe('');
    }
    expect(formatStatusChangedAt('not a date')).toBe('');
    expect(formatStatusChangedAt(new Date('nonsense'))).toBe('');
  });

  it('formats an ISO string as a short local date', () => {
    expect(formatStatusChangedAt('2026-10-03T15:30:00.000Z')).toMatch(/^[A-Z][a-z]{2}\.? \d{1,2}$/);
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(formatStatusChangedAt(new Date('2026-10-03T15:30:00.000Z')))
      .toBe(formatStatusChangedAt('2026-10-03T15:30:00.000Z'));
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
