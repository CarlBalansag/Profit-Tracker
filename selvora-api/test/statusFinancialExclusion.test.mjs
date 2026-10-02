// Checkpoint 3: the two halves of closing the financial-exclusion gap.
//
// Belt: an exception transition that lands on a status the legacy vocabulary
// also has (CANCELLED/RETURNED/DISPUTED) writes the legacy `status` column in
// the same statement, so the screens that still read it exclude the sale.
//
// Suspenders: isRealizedSale (services/decimalFinance.js and its isomorphic
// twin shared/finance.mjs) now reads BOTH status columns, so a row that only
// has the new one set is excluded too -- while every pre-existing row, all of
// which have workflow_status = NULL, is classified exactly as it was before.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { isRealizedSale as isRealizedSaleShared } from '../../shared/finance.mjs';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { isRealizedSale } = require('../services/decimalFinance.js');
const {
  EXCLUDED_FROM_FINANCIALS,
  WORKFLOW_TO_LEGACY_SALE_STATUS,
  SALE_EXCEPTION_STATUSES,
  SALE_STATUSES_BY_WORKFLOW,
  legacySaleStatusPatch,
} = require('../services/statusTransitions.js');
const { LEGACY_SALE_STATUSES } = require('../scripts/migrateStatusWorkflow.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => harness.reset());
afterAll(() => server.close());

const send = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const act = (id, action, body) => send('POST', `/api/sales/${id}/actions/${action}`, body);
const dashboard = async () => send('GET', '/api/analytics/dashboard?mode=All&date=All%20Time');

const seedSale = (overrides = {}) => {
  Object.assign(harness.db.sales[0], {
    // `status` is restated so re-seeding inside one test resets the legacy
    // column too; 'SOLD' is the fixture's own value.
    status: 'SOLD',
    workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT',
    paid_at: null, cancelled_at: null, voided_at: null, returned_at: null,
    return_requested_at: null, disputed_at: null,
    ...overrides,
  });
  return harness.db.sales[0];
};

// ---------------------------------------------------------------------------
// Suspenders: the isRealizedSale cutover
// ---------------------------------------------------------------------------

// The exact predicate that shipped before this checkpoint, frozen as a literal.
// It is the spec for every row that has only the legacy column set.
const preCutoverIsRealizedSale = (sale) =>
  !['CANCELLED', 'RETURNED', 'DISPUTED'].includes((sale.status || '').toUpperCase());

// A row the backfill has not reached has workflow_status NULL; a route whose
// `select` omits the column hands over `undefined`. Both must behave as before.
const UNSET_WORKFLOW_STATUS = [null, undefined, ''];
const LEGACY_STATUS_INPUTS = [...LEGACY_SALE_STATUSES, 'cancelled', 'Returned', 'dIsPuTeD', 'SOLD', '', null, undefined];

describe('isRealizedSale: pre-existing rows are classified exactly as before', () => {
  it('matches the pre-cutover predicate for every legacy status with no workflow_status', () => {
    for (const workflow_status of UNSET_WORKFLOW_STATUS) {
      for (const status of LEGACY_STATUS_INPUTS) {
        const sale = { workflow_status, status };
        const expected = preCutoverIsRealizedSale(sale);
        expect(isRealizedSale(sale), `${String(workflow_status)}/${String(status)}`).toBe(expected);
      }
    }
  });

  it('keeps the two headline cases explicit: SOLD realized, CANCELLED excluded', () => {
    expect(isRealizedSale({ workflow_status: null, status: 'SOLD' })).toBe(true);
    expect(preCutoverIsRealizedSale({ workflow_status: null, status: 'SOLD' })).toBe(true);
    expect(isRealizedSale({ workflow_status: null, status: 'CANCELLED' })).toBe(false);
    expect(preCutoverIsRealizedSale({ workflow_status: null, status: 'CANCELLED' })).toBe(false);
  });

  it('still excludes a sale the legacy status dropdown cancelled, whatever its workflow_status says', () => {
    // A sale created after checkpoint 2 has a workflow_status from creation.
    // Cancelling it through the existing UI writes only the legacy column, so
    // preferring the new column alone would have quietly re-realized it.
    for (const workflow_status of [...SALE_STATUSES_BY_WORKFLOW.STANDARD_MARKETPLACE, 'AWAITING_HANDOFF']) {
      for (const status of ['CANCELLED', 'RETURNED', 'DISPUTED']) {
        expect(isRealizedSale({ workflow_status, status }), `${workflow_status}/${status}`).toBe(false);
      }
    }
  });
});

describe('isRealizedSale: the new workflow_status column', () => {
  it('excludes a sale voided through an action endpoint even if the legacy column still says SOLD', () => {
    // This is the gap being closed: before the cutover this returned true.
    expect(isRealizedSale({ workflow_status: 'CANCELLED', status: 'SOLD' })).toBe(false);
    expect(preCutoverIsRealizedSale({ workflow_status: 'CANCELLED', status: 'SOLD' })).toBe(true);
  });

  it('excludes exactly the statuses EXCLUDED_FROM_FINANCIALS names, from either column', () => {
    for (const status of EXCLUDED_FROM_FINANCIALS) {
      expect(isRealizedSale({ workflow_status: status, status: 'SOLD' }), status).toBe(false);
      expect(isRealizedSale({ workflow_status: status.toLowerCase(), status: 'SOLD' }), status).toBe(false);
      expect(isRealizedSale({ workflow_status: 'PAID', status }), status).toBe(false);
    }
    // The two exception statuses with no legacy equivalent are NOT exclusions:
    // a requested return and a failed authentication have not taken the money
    // back yet, and the item is not back in stock either.
    for (const status of SALE_EXCEPTION_STATUSES.filter((s) => !EXCLUDED_FROM_FINANCIALS.includes(s))) {
      expect(status, 'unexpected new exception status').toMatch(/RETURN_IN_PROGRESS|AUTHENTICATION_FAILED/);
      expect(isRealizedSale({ workflow_status: status, status: 'SOLD' }), status).toBe(true);
    }
    // Every normal-path status of every workflow stays realized.
    for (const path of Object.values(SALE_STATUSES_BY_WORKFLOW)) {
      for (const status of path) expect(isRealizedSale({ workflow_status: status, status: 'SOLD' }), status).toBe(true);
    }
  });
});

describe('shared/finance.mjs stays identical to services/decimalFinance.js', () => {
  it('agrees on every combination of the two columns', () => {
    const workflowInputs = [...UNSET_WORKFLOW_STATUS, ...SALE_EXCEPTION_STATUSES, ...Object.values(SALE_STATUSES_BY_WORKFLOW).flat(), 'cancelled'];
    for (const workflow_status of workflowInputs) {
      for (const status of LEGACY_STATUS_INPUTS) {
        const sale = { workflow_status, status };
        expect(isRealizedSaleShared(sale), `${String(workflow_status)}/${String(status)}`).toBe(isRealizedSale(sale));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Belt: the dual-write
// ---------------------------------------------------------------------------

describe('legacySaleStatusPatch', () => {
  it('maps only the exception statuses the legacy vocabulary actually has', () => {
    expect(WORKFLOW_TO_LEGACY_SALE_STATUS).toEqual({ CANCELLED: 'CANCELLED', RETURNED: 'RETURNED', DISPUTED: 'DISPUTED' });
    // Every mapped value is a real legacy status, and every one of them is in
    // the excluded set -- that pairing is the whole point of the dual-write.
    for (const [workflow, legacy] of Object.entries(WORKFLOW_TO_LEGACY_SALE_STATUS)) {
      expect(LEGACY_SALE_STATUSES).toContain(legacy);
      expect(EXCLUDED_FROM_FINANCIALS).toContain(workflow);
      expect(legacySaleStatusPatch(workflow)).toEqual({ status: legacy });
    }
    expect(Object.keys(WORKFLOW_TO_LEGACY_SALE_STATUS).sort()).toEqual([...EXCLUDED_FROM_FINANCIALS].sort());
  });

  it('invents nothing for a status with no legacy equivalent', () => {
    for (const status of ['RETURN_IN_PROGRESS', 'AUTHENTICATION_FAILED', 'WAITING_FOR_PAYMENT', 'HANDED_OVER', 'OUTBOUND', undefined, null, '']) {
      expect(legacySaleStatusPatch(status), String(status)).toEqual({});
    }
  });
});

describe('exception actions write both status columns', () => {
  it('void_sale sets workflow_status and the legacy status to CANCELLED in one transition', async () => {
    seedSale();
    harness.db.inventory[0].qty_on_hand = 3;
    const res = await act(harness.ids.sale, 'void_sale');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ workflow_status: 'CANCELLED', status: 'CANCELLED' });
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'CANCELLED', status: 'CANCELLED' });
    expect(harness.db.sales[0].voided_at).toBeTruthy();
    // The inventory restore still happens, exactly once.
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  it('cancel_sale sets both columns to CANCELLED', async () => {
    seedSale();
    const res = await act(harness.ids.sale, 'cancel_sale');
    expect(res.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'CANCELLED', status: 'CANCELLED' });
    expect(harness.db.sales[0].cancelled_at).toBeTruthy();
  });

  it('report_dispute sets both columns to DISPUTED', async () => {
    seedSale();
    const res = await act(harness.ids.sale, 'report_dispute');
    expect(res.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'DISPUTED', status: 'DISPUTED' });
    expect(harness.db.sales[0].disputed_at).toBeTruthy();
  });

  it('leaves the legacy column alone for a return that has only been requested, then writes it when the item arrives', async () => {
    seedSale();
    harness.db.inventory[0].qty_on_hand = 3;
    const requested = await act(harness.ids.sale, 'report_return');
    expect(requested.status).toBe(200);
    // RETURN_IN_PROGRESS has no legacy equivalent, and the money is not back
    // yet, so the legacy column keeps the value it had.
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'RETURN_IN_PROGRESS', status: 'SOLD' });
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);

    const received = await act(harness.ids.sale, 'mark_returned');
    expect(received.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'RETURNED', status: 'RETURNED' });
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  it('leaves the legacy column alone for a failed authentication', async () => {
    seedSale({ workflow_type: 'AUTH_MARKETPLACE', workflow_status: 'AUTHENTICATING' });
    const res = await act(harness.ids.sale, 'mark_authentication_failed');
    expect(res.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'AUTHENTICATION_FAILED', status: 'SOLD' });
  });

  it('writes the legacy column when a correction lands on an exception status, and not otherwise', async () => {
    seedSale();
    expect((await act(harness.ids.sale, 'correct_status', { workflow_status: 'DISPUTED' })).status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'DISPUTED', status: 'DISPUTED' });

    seedSale();
    expect((await act(harness.ids.sale, 'correct_status', { workflow_status: 'OUTBOUND' })).status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'OUTBOUND', status: 'SOLD' });
  });

  it('never touches the legacy column on a normal forward transition', async () => {
    seedSale();
    const res = await act(harness.ids.sale, 'mark_paid', { paid_date: '2026-09-30', amount: '288.00' });
    expect(res.status).toBe(200);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'PAID', status: 'SOLD' });
  });

  it('writes neither column when the transition is rejected', async () => {
    seedSale({ workflow_status: 'CANCELLED', status: 'CANCELLED' });
    expect((await act(harness.ids.sale, 'cancel_sale')).status).toBe(409);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'CANCELLED', status: 'CANCELLED' });

    seedSale();
    harness.db.inventory[0].user_id = harness.ids.other;
    expect((await act(harness.ids.sale, 'void_sale')).status).toBe(404);
    expect(harness.db.sales[0]).toMatchObject({ workflow_status: 'WAITING_FOR_PAYMENT', status: 'SOLD' });
  });
});

// ---------------------------------------------------------------------------
// The bug, end to end
// ---------------------------------------------------------------------------

describe('a voided sale disappears from the financial totals', () => {
  it('is excluded from dashboard revenue, profit and units sold after the action endpoint runs', async () => {
    seedSale();
    const before = await dashboard();
    expect(before.status).toBe(200);
    expect(before.body.stats.totalRevenue).toBeGreaterThan(0);

    expect((await act(harness.ids.sale, 'void_sale')).status).toBe(200);
    const after = await dashboard();
    expect(after.status).toBe(200);
    expect(after.body.stats).toMatchObject({ totalRevenue: 0, profit: 0, unitsSold: 0, salesCount: 0 });
    expect(after.body.cashFlowTransactions).toEqual([]);
  });

  it('is excluded even when only the new column carries the exclusion', async () => {
    // A row voided before the dual-write landed: workflow_status CANCELLED,
    // legacy status untouched. The isRealizedSale cutover is what catches it.
    seedSale({ workflow_status: 'CANCELLED', status: 'SOLD' });
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ totalRevenue: 0, profit: 0, unitsSold: 0, salesCount: 0 });
  });
});
