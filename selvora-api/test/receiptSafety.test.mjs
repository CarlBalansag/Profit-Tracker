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
  it('never overwrites the previous asset in place', async () => {
    await attach(harness.ids.inventory);
    const upload = harness.calls.find((call) => call.op === 'upload');
    expect(upload.options.overwrite).toBe(false);
    expect(upload.options.public_id).not.toBe(`inventory_${harness.ids.inventory}`);
  });
  it('cleans up the new upload and preserves the previous receipt when the database save fails', async () => {
    harness.db.inventory[0].receipt_url = 'https://example.invalid/previous-receipt.png';
    harness.faults['inventory.update'] = true;
    const response = await attach(harness.ids.inventory);
    expect(response.status).toBe(500);
    expect(harness.db.inventory[0].receipt_url).toBe('https://example.invalid/previous-receipt.png');
    const destroy = harness.calls.find((call) => call.op === 'destroy');
    expect(destroy.publicId).toBe(harness.calls.find((call) => call.op === 'upload').options.public_id);
  });
  it.each([
    ['empty', 'data:image/png;base64,'],
    ['not a multiple of 4', 'data:image/png;base64,YWJ'],
    ['invalid characters', 'data:image/png;base64,!!!!'],
  ])('rejects malformed base64 data (%s) before uploading', async (label, fileData) => {
    const response = await fetch(`${baseUrl}/api/receipts/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemType: 'inventory', itemId: harness.ids.inventory, fileData }) });
    expect(response.status).toBe(400);
    expect(harness.calls.some((call) => call.model === 'cloudinary')).toBe(false);
  });
});
