import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');

let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => harness.reset());
afterEach(() => vi.restoreAllMocks());
afterAll(() => server.close());

// What the server writes to its log while adding a purchase.
async function logged(body) {
  const lines = [];
  for (const method of ['log', 'info', 'debug', 'warn', 'error']) {
    vi.spyOn(console, method).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
  const res = await fetch(`${baseUrl}/api/inventory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, text: lines.join('\n') };
}

describe('adding a purchase keeps its details out of the server log', () => {
  const body = { product_name: 'QA Private Purchase', vendor_id: harness.ids.vendor, payment_method_id: harness.ids.card, unit_purchase_cost: '1234.56', qty_purchased: 1, order_number: 'QA-ORDER-778899', notes: 'qa private note' };

  it.each([
    ['saved', body, 200],
    ['refused', { ...body, unit_purchase_cost: '1234.567' }, 400],
  ])('when the purchase is %s', async (_label, sent, status) => {
    const result = await logged(sent);
    expect(result.status).toBe(status);
    for (const secret of ['QA Private Purchase', '1234.56', 'QA-ORDER-778899', 'qa private note']) expect(result.text).not.toContain(secret);
  });
});
