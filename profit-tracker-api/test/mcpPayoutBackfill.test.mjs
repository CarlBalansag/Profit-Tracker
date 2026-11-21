import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const payload = await response.json();
  if (payload.error) return { rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { isError: result.isError || false, data };
}

const sale = () => harness.db.sales[0];
// The fixture sale's expected net: 150*2 - 15 - 12 = 273.
const pay = (extra = {}) => callTool('mark_sale_paid', {
  sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273, payout_account: 'PayPal', ...extra,
});

describe('mark_sale_paid backfills a sale already PAID with no payment recorded', () => {
  it('adds the payout details and leaves the status (and when it changed) alone', async () => {
    sale().workflow_status = 'PAID';
    const changedAt = new Date('2026-10-01T12:00:00Z');
    sale().workflow_status_changed_at = changedAt;
    const { isError, data } = await pay({ payout_reference: 'Deposit 1' });
    expect(isError).toBe(false);
    expect(data[0]).toMatchObject({ payout_status: 'paid', payout_date: '2026-10-08', payout_amount: 273, payout_account: 'PayPal', payout_reference: 'Deposit 1' });
    expect(sale().workflow_status).toBe('PAID');
    expect(sale().workflow_status_changed_at).toEqual(changedAt);
  });

  it('records a short payment on a backfill as partial', async () => {
    sale().workflow_status = 'PAID';
    const { data } = await pay({ payout_amount: 250 });
    expect(data[0].payout_status).toBe('partial');
    expect(data[0].payout_short_amount).toBe(23);
  });

  it('backfills a legacy row marked PAID only in the old status column', async () => {
    sale().workflow_status = null;
    sale().status = 'PAID';
    const { isError, data } = await pay();
    expect(isError).toBe(false);
    expect(data[0].payout_date).toBe('2026-10-08');
    expect(sale().workflow_status).toBe('PAID');
  });

  it('refuses a PAID sale that already has a payment recorded, and changes nothing', async () => {
    sale().workflow_status = 'PAID';
    sale().paid_at = new Date('2026-10-02T12:00:00Z');
    sale().paid_amount = 273;
    const { isError, data } = await pay({ payout_amount: 100 });
    expect(isError).toBe(true);
    expect(data).toContain('not eligible');
    expect(sale().paid_amount).toBe(273);
    expect(harness.db.activityLog).toHaveLength(0);
  });

  it('still refuses a sale that has not shipped yet', async () => {
    sale().workflow_status = 'AWAITING_SHIPMENT';
    const { isError } = await pay();
    expect(isError).toBe(true);
    expect(sale().paid_at).toBeNull();
  });

  it('refuses the whole deposit when one sale in it is not eligible', async () => {
    sale().workflow_status = 'PAID';
    harness.db.sales.push({ ...structuredClone(sale()), id: '99999999-0000-4000-8000-000000000001', workflow_status: 'AWAITING_SHIPMENT' });
    const { isError } = await callTool('mark_sale_paid', {
      sale_ids: [harness.ids.sale, '99999999-0000-4000-8000-000000000001'], payout_date: '2026-10-08', payout_amount: 546,
    });
    expect(isError).toBe(true);
    expect(sale().paid_at).toBeNull();
  });
});

describe('mark_sale_paid is logged in Activity', () => {
  it('logs one entry per deposit, marked as the assistant, and returns its id', async () => {
    sale().workflow_status = 'WAITING_FOR_PAYMENT';
    const second = { ...structuredClone(sale()), id: '99999999-0000-4000-8000-000000000002' };
    harness.db.sales.push(second);
    const { data } = await callTool('mark_sale_paid', {
      sale_ids: [harness.ids.sale, second.id], payout_date: '2026-10-08', payout_amount: 546,
    });
    expect(data).toHaveLength(2);
    expect(data[0].activity_id).toBeTruthy();
    expect(data[1].activity_id).toBe(data[0].activity_id);
    expect(harness.db.activityLog).toHaveLength(1);
    expect(harness.db.activityLog[0].source).toBe('assistant');
  });

  it('undo_activity un-pays every sale in the deposit', async () => {
    sale().workflow_status = 'WAITING_FOR_PAYMENT';
    const { data } = await pay();
    const undo = await callTool('undo_activity', { activity_id: data[0].activity_id, confirm: true });
    expect(undo.isError).toBe(false);
    expect(sale().paid_at).toBeNull();
    expect(sale().paid_amount).toBeNull();
    expect(sale().payout_account).toBeNull();
    expect(sale().workflow_status).toBe('WAITING_FOR_PAYMENT');
    const { data: listed } = await callTool('list_sales', {});
    expect(listed[0].payout_status).toBe('unpaid');
  });

  it('the website batch route logs too, as the website', async () => {
    sale().workflow_status = 'WAITING_FOR_PAYMENT';
    const response = await fetch(`${baseUrl}/api/sales/mark-paid-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273 }),
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
    expect(harness.db.activityLog).toHaveLength(1);
    expect(harness.db.activityLog[0].source).toBe('web');
  });
});
