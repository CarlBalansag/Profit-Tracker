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
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { isError: result.isError || false, data };
}

describe('mark_sale_paid buyer attribution', () => {
  it('attributes a new buyer to every sale in the batch and creates it', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    const { data } = await callTool('mark_sale_paid', {
      sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273, buyer: 'Windy City',
    });
    expect(data[0].buyer_id).toBeTruthy();
    const buyer = harness.db.buyer.find((b) => b.id === data[0].buyer_id);
    expect(buyer.name).toBe('Windy City');
  });

  it('reuses an existing buyer by name, case-insensitively, instead of duplicating', async () => {
    harness.db.buyer.push({ id: 'existing-buyer', user_id: harness.ids.user, name: 'Windy City' });
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    const { data } = await callTool('mark_sale_paid', {
      sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273, buyer: 'windy city',
    });
    expect(data[0].buyer_id).toBe('existing-buyer');
    expect(harness.db.buyer).toHaveLength(1);
  });

  it('leaves buyer_id untouched when no buyer is given', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    harness.db.sales[0].buyer_id = 'already-set';
    harness.db.buyer.push({ id: 'already-set', user_id: harness.ids.user, name: 'Blake' });
    const { data } = await callTool('mark_sale_paid', { sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273 });
    expect(data[0].buyer_id).toBe('already-set');
  });
});

describe('update_sale_buyer', () => {
  it('sets the buyer on a sale regardless of payment status', async () => {
    // PAID sales are not eligible for mark_paid, but should still be
    // correctable -- this is the backfill path for already-paid sales.
    harness.db.sales[0].workflow_status = 'PAID';
    harness.db.sales[0].paid_at = new Date('2026-09-10T12:00:00Z');
    const { data } = await callTool('update_sale_buyer', { sale_id: harness.ids.sale, buyer: 'Tradepost' });
    expect(data.buyer_id).toBeTruthy();
    expect(harness.db.buyer.find((b) => b.id === data.buyer_id).name).toBe('Tradepost');
  });

  it('404s (as a tool error) for a sale that does not exist', async () => {
    const { isError } = await callTool('update_sale_buyer', { sale_id: '99999999-9999-4999-8999-000000000000', buyer: 'Blake' });
    expect(isError).toBe(true);
  });
});

describe('mark_sale_paid now allows OUTBOUND (and still allows WAITING_FOR_PAYMENT)', () => {
  it('pays an OUTBOUND sale and sets workflow_status to PAID', async () => {
    harness.db.sales[0].workflow_status = 'OUTBOUND';
    const { data } = await callTool('mark_sale_paid', { sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273 });
    expect(data[0].payout_status).toBe('paid');
    expect(harness.db.sales[0].workflow_status).toBe('PAID');
  });

  it('still pays a WAITING_FOR_PAYMENT sale (unchanged behavior)', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    const { data } = await callTool('mark_sale_paid', { sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273 });
    expect(data[0].payout_status).toBe('paid');
  });

  it('still rejects a sale with no workflow_status at all (unresolved legacy row)', async () => {
    const { isError } = await callTool('mark_sale_paid', { sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273 });
    expect(isError).toBe(true);
  });
});
