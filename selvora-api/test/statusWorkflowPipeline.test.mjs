// The Status Pipeline (Dashboard's "Status Pipeline" card, and the counts
// CashFlow.jsx/CreditCard.jsx read from the same endpoint) predates the
// status-workflow rollout and has always bucketed every record by its legacy
// `status` string. None of the new action-transition endpoints (the Statuses
// board's buttons) keep that legacy string in sync — see
// services/statusTransitions.js's applyTransition — so without
// pipelineBucketOf, a record moved through the new board would be stuck
// forever in whichever bucket its legacy status happened to be in when the
// board took over. These tests lock in that the pipeline reads the new
// columns first and only falls back to the legacy string for a row the
// rollout hasn't reached yet (receiving_status/workflow_status still null).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { pipelineBucketOf } = require('../services/statusTransitions.js');

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

describe('pipelineBucketOf', () => {
  it('returns null for a record the rollout has not reached, so callers fall back to legacy status', () => {
    expect(pipelineBucketOf({ receiving_status: null }, 'inventory')).toBeNull();
    expect(pipelineBucketOf({ workflow_status: null }, 'sale')).toBeNull();
  });

  it('buckets every receiving status, with is_listed taking priority over ON_HAND', () => {
    expect(pipelineBucketOf({ receiving_status: 'PRE_ORDER' }, 'inventory')).toBe('Pre Order');
    expect(pipelineBucketOf({ receiving_status: 'PURCHASED' }, 'inventory')).toBe('PURCHASED');
    expect(pipelineBucketOf({ receiving_status: 'INBOUND' }, 'inventory')).toBe('SHIPPED');
    expect(pipelineBucketOf({ receiving_status: 'ON_HAND' }, 'inventory')).toBe('On Hand');
    expect(pipelineBucketOf({ receiving_status: 'ON_HAND', is_listed: true }, 'inventory')).toBe('LISTED');
  });

  it('buckets every forward-path and exception sale status across all four workflows', () => {
    const cases = {
      AWAITING_SHIPMENT: 'SOLD',
      AWAITING_HANDOFF: 'SOLD',
      OUTBOUND: 'IN_TRANSIT_OUT',
      WAITING_FOR_SCAN_IN: 'IN_TRANSIT_OUT',
      DELIVERED_TO_AUTHENTICATOR: 'DELIVERED',
      DELIVERED_TO_PROVIDER: 'DELIVERED',
      HANDED_OVER: 'DELIVERED',
      ACCEPTED: 'DELIVERED',
      SCANNED_IN: 'SCANNED_IN',
      AUTHENTICATING: 'AUTHENTICATION',
      WAITING_FOR_PAYMENT: 'PENDING_PAYMENT',
      PAID: 'PAID',
      CANCELLED: 'CANCELLED',
      RETURN_IN_PROGRESS: 'RETURNED',
      RETURNED: 'RETURNED',
      AUTHENTICATION_FAILED: 'RETURNED',
      DISPUTED: 'DISPUTED',
    };
    for (const [workflow_status, bucket] of Object.entries(cases)) {
      expect(pipelineBucketOf({ workflow_status }, 'sale'), workflow_status).toBe(bucket);
    }
  });

  it('a sale still showing derived-Completed on the Statuses board stays bucketed as PAID', () => {
    // workflow_status never becomes anything but PAID for "Completed" (see
    // isFullyCompleted in the frontend's data/statusWorkflow.js) -- the
    // pipeline has to agree, or a paid-and-done sale would vanish from both
    // the PAID and COMPLETED buckets.
    expect(pipelineBucketOf({ workflow_status: 'PAID', completed_at: new Date() }, 'sale')).toBe('PAID');
  });
});

describe('GET /api/analytics/dashboard pipelineCounts', () => {
  it('buckets an inventory row by receiving_status, ignoring a stale legacy status', async () => {
    harness.db.inventory.push({
      ...harness.db.inventory[0],
      id: 'inv-new-col', status: 'PURCHASED', receiving_status: 'ON_HAND', qty_on_hand: 4,
    });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(res.body.pipelineCounts['On Hand']).toBeGreaterThanOrEqual(4);
    // Not double-counted into the legacy PURCHASED bucket its stale status implies.
  });

  it('buckets a listed inventory row as LISTED from is_listed, ignoring a stale legacy status', async () => {
    harness.db.inventory.push({
      ...harness.db.inventory[0],
      id: 'inv-listed', status: 'PURCHASED', receiving_status: 'ON_HAND', is_listed: true, qty_on_hand: 2,
    });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(res.body.pipelineCounts.LISTED).toBeGreaterThanOrEqual(2);
    expect(res.body.stats.listedQty).toBeGreaterThanOrEqual(2);
  });

  it('buckets a sale by workflow_status, ignoring a stale legacy status', async () => {
    harness.db.sales.push({
      ...harness.db.sales[0], id: 'sale-new-col', status: 'SOLD', workflow_status: 'SCANNED_IN', quantity: 3,
    });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(res.body.pipelineCounts.SCANNED_IN).toBeGreaterThanOrEqual(3);
  });

  it('still falls back to the legacy status string for a row the rollout has not reached', async () => {
    // The default harness inventory row is legacy-only (status PURCHASED, no
    // receiving_status) -- regression guard for pre-existing unmigrated data.
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(res.body.pipelineCounts.PURCHASED).toBeGreaterThanOrEqual(harness.db.inventory[0].qty_on_hand);
    expect(res.body.pipelineCounts.SOLD).toBeGreaterThanOrEqual(harness.db.sales[0].quantity);
  });
});
