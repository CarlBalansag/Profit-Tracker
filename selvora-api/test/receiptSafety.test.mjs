import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
let server; let baseUrl;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
beforeEach(() => harness.reset());
afterAll(() => server.close());
const attach = async (itemId, fileData = 'data:image/png;base64,YWJj') => {
  const response = await fetch(`${baseUrl}/api/receipts/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemType: 'inventory', itemId, fileData }) });
  return { status: response.status, body: await response.json() };
};
describe('receipt upload safety', () => {
  it('preserves an old receipt on database failure and cleans only the newly uploaded asset', async () => {
    harness.db.inventory[0].receipt_url = 'https://example.invalid/old.png';
    harness.faults['inventory.update'] = true;
    expect((await attach(harness.ids.inventory)).status).toBe(500);
    expect(harness.db.inventory[0].receipt_url).toBe('https://example.invalid/old.png');
    const upload = harness.calls.find(call => call.model === 'cloudinary' && call.op === 'upload');
    const cleanup = harness.calls.find(call => call.model === 'cloudinary' && call.op === 'destroy');
    expect(upload.options.overwrite).toBe(false);
    expect(cleanup.publicId).toBe(upload.options.public_id);
    expect(cleanup.options.resource_type).toBe('image');
    harness.faults['inventory.update'] = false;
    expect((await attach(harness.ids.inventory)).status).toBe(200);
    const uploads = harness.calls.filter(call => call.model === 'cloudinary' && call.op === 'upload');
    expect(uploads[1].options.public_id).not.toBe(uploads[0].options.public_id);
  });
  it('preserves the old receipt even if cleanup of the failed new upload also fails', async () => {
    harness.db.inventory[0].receipt_url = 'https://example.invalid/old.png';
    harness.faults['inventory.update'] = true; harness.faults['cloudinary.destroy'] = true;
    expect((await attach(harness.ids.inventory)).status).toBe(500);
    expect(harness.db.inventory[0].receipt_url).toBe('https://example.invalid/old.png');
    expect(harness.calls.filter(call => call.model === 'cloudinary' && call.op === 'destroy')).toHaveLength(1);
  });
  it.each([150 * 1024, 5 * 1024 * 1024])('accepts an owned %s-byte attachment through the production JSON parser', async size => {
    const file = `data:application/pdf;base64,${Buffer.alloc(size, 1).toString('base64')}`;
    expect((await attach(harness.ids.inventory, file)).status).toBe(200);
    expect(harness.calls.filter(call => call.model === 'cloudinary' && call.op === 'upload')).toHaveLength(1);
  });
  it('rejects one byte over the limit before upload and preserves the old attachment', async () => {
    harness.db.inventory[0].receipt_url = 'https://example.invalid/old.png';
    const file = `data:application/pdf;base64,${Buffer.alloc(5 * 1024 * 1024 + 1, 1).toString('base64')}`;
    expect((await attach(harness.ids.inventory, file)).status).toBe(400);
    expect(harness.calls.some(call => call.model === 'cloudinary')).toBe(false);
    expect(harness.db.inventory[0].receipt_url).toBe('https://example.invalid/old.png');
  });
  it.each(['data:image/png;base64,', 'data:image/png;base64,ab@@', 'data:image/png;base64,abc', 'data:text/plain;base64,YWJj'])('rejects malformed/unsupported %s before upload', async file => {
    expect((await attach(harness.ids.inventory, file)).status).toBe(400);
    expect(harness.calls.some(call => call.model === 'cloudinary')).toBe(false);
  });
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
