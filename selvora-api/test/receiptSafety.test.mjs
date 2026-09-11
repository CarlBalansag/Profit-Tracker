import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
let server; let baseUrl;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
beforeEach(() => harness.reset());
afterAll(() => server.close());
const attach = async (itemId) => {
  const response = await fetch(`${baseUrl}/api/receipts/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemType: 'inventory', itemId, fileData: 'data:image/png;base64,YWJj' }) });
  return { status: response.status, body: await response.json() };
};
describe('receipt upload safety', () => {
  it('uses the full purchase cost for inventory receipt amounts', async () => {
    const response = await fetch(`${baseUrl}/api/receipts`);
    const body = await response.json();
    const inventory = body.withoutReceipts.find((item) => item.id === harness.ids.inventory);

    expect(response.status).toBe(200);
    expect(inventory.amount).toBe(520);
  });

  it('checks ownership before uploading to Cloudinary', async () => {
    const response = await attach(harness.ids.foreign);
    expect(response.status).toBe(404);
    expect(harness.calls.some((call) => call.model === 'cloudinary')).toBe(false);
  });
  it('uploads only after the owned target is verified', async () => {
    const response = await attach(harness.ids.inventory);
    expect(response.status).toBe(200);
    expect(harness.calls.some((call) => call.model === 'cloudinary')).toBe(true);
  });
});
