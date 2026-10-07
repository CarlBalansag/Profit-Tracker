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

  it('no longer accepts a buyer param -- the sale\'s platform is the buyer now', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    const { data } = await callTool('mark_sale_paid', {
      sale_ids: [harness.ids.sale], payout_date: '2026-10-08', payout_amount: 273, buyer: 'Windy City',
    });
    // The SDK strips unknown keys per its inputSchema rather than erroring,
    // so this just confirms it still succeeds and writes nothing buyer-related.
    expect(data[0].payout_status).toBe('paid');
    expect(data[0].buyer_id).toBeUndefined();
  });
});

describe('removed tools', () => {
  it('update_sale_buyer no longer exists', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: 'update_sale_buyer', arguments: { sale_id: harness.ids.sale, buyer: 'Blake' } } }),
    });
    const payload = await response.json();
    // Unregistered tool: McpServer surfaces this as a normal CallToolResult
    // with isError, not a bare JSON-RPC error.
    expect(payload.error || payload.result?.isError).toBeTruthy();
  });
});
