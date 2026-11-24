// Private receipts: new uploads are "authenticated" Cloudinary assets stored
// as a reference, and are only ever shown as a short-lived signed link, to the
// owner, for the item they were uploaded to.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const cloudinary = require('cloudinary').v2;
const { privateRef, parsePrivateRef, belongsTo, receiptLink, withReceiptLink } = require('../services/privateReceipts');
const { receiptFileFromUrl } = require('../services/dataReset');

const FOLDER = 'profittracker/receipts/';
const ref = (type, id, format = 'jpg', uuid = '9d2f') => privateRef({ resourceType: 'image', format, publicId: `${FOLDER}${type}_${id}_${uuid}` });

beforeAll(() => cloudinary.config({ cloud_name: 'qa-cloud', api_key: '1234', api_secret: 'qa-secret' }));

describe('private receipt references', () => {
  it('round-trips, and only belongs to the item it was uploaded for', () => {
    const r = parsePrivateRef(ref('expense', 'e1'));
    expect(r).toEqual({ resourceType: 'image', format: 'jpg', publicId: `${FOLDER}expense_e1_9d2f` });
    expect(belongsTo(r, 'expense', 'e1')).toBe(true);
    expect(belongsTo(r, 'expense', 'e2')).toBe(false);
    expect(belongsTo(r, 'inventory', 'e1')).toBe(false);
    // "e1" mustn't match "e10", and nothing outside the receipts folder counts.
    expect(belongsTo(parsePrivateRef(ref('expense', 'e10')), 'expense', 'e1')).toBe(false);
    expect(belongsTo(parsePrivateRef(`private:image:jpg:other/expense_e1_x`), 'expense', 'e1')).toBe(false);
    expect(parsePrivateRef('https://res.cloudinary.com/x.png')).toBeNull();
    expect(parsePrivateRef('private:bogus')).toBeNull();
  });

  it('signs a link that expires in 10 minutes, and nothing else', () => {
    const now = Date.UTC(2026, 10, 22, 12);
    const link = receiptLink(ref('expense', 'e1'), 'expense', 'e1', now);
    const url = new URL(link);
    expect(url.hostname).toBe('api.cloudinary.com');
    expect(url.searchParams.get('type')).toBe('authenticated');
    expect(url.searchParams.get('format')).toBe('jpg');
    expect(Number(url.searchParams.get('expires_at'))).toBe(now / 1000 + 600);
    expect(url.searchParams.get('signature')).toBeTruthy();
    expect(link).not.toContain('qa-secret');
    // Copied onto another item: never signed.
    expect(receiptLink(ref('expense', 'e1'), 'expense', 'e2')).toBeNull();
    // Older public receipts pass through unchanged.
    expect(receiptLink('https://res.cloudinary.com/qa/image/upload/old.png', 'expense', 'e1')).toBe('https://res.cloudinary.com/qa/image/upload/old.png');
    expect(withReceiptLink({ id: 'e1', receipt_url: null }, 'expense')).toEqual({ id: 'e1', receipt_url: null, receipt_private: false });
  });

  it('lets a data reset delete only its own private files', () => {
    const owned = new Set(['expense:e1']);
    expect(receiptFileFromUrl(ref('expense', 'e1'), owned)).toEqual({ publicId: `${FOLDER}expense_e1_9d2f`, resourceType: 'image', type: 'authenticated' });
    expect(receiptFileFromUrl(ref('expense', 'e2'), owned)).toBeNull();
  });
});

describe('private receipts over the API', () => {
  let server; let base;
  beforeAll(async () => {
    server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`;
    // Loading the receipts route configures Cloudinary from (empty) env vars.
    cloudinary.config({ cloud_name: 'qa-cloud', api_key: '1234', api_secret: 'qa-secret' });
  });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });
  const send = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const expenseId = () => harness.db.expense[0].id;

  it('uploads privately, stores a reference, and returns a signed link', async () => {
    const res = await send('POST', '/api/receipts/attach', { itemType: 'expense', itemId: expenseId(), fileData: 'data:image/png;base64,YWJj' });
    expect(res.status).toBe(200);
    const upload = harness.calls.find((c) => c.op === 'upload');
    expect(upload.options).toMatchObject({ type: 'authenticated', folder: 'profittracker/receipts', overwrite: false });
    const stored = harness.db.expense[0].receipt_url;
    expect(stored).toMatch(new RegExp(`^private:image:png:profittracker/receipts/expense_${expenseId()}_`));
    expect(res.body.receipt_private).toBe(true);
    expect(new URL(res.body.receipt_url).searchParams.get('type')).toBe('authenticated');
  });

  it('shows signed links on Receipts, Expenses, the purchase and the Schedule C worksheet', async () => {
    await send('POST', '/api/receipts/attach', { itemType: 'expense', itemId: expenseId(), fileData: 'data:image/png;base64,YWJj' });
    await send('POST', '/api/receipts/attach', { itemType: 'inventory', itemId: harness.ids.inventory, fileData: 'data:image/png;base64,YWJj' });
    const signed = (url) => url && new URL(url).hostname === 'api.cloudinary.com';
    const receipts = (await send('GET', '/api/receipts')).body.withReceipts;
    expect(receipts).toHaveLength(2);
    expect(receipts.every((r) => signed(r.receipt_url) && r.receipt_private)).toBe(true);
    expect(signed((await send('GET', '/api/expenses')).body[0].receipt_url)).toBe(true);
    expect(signed((await send('GET', `/api/inventory/${harness.ids.inventory}`)).body.receipt_url)).toBe(true);
    expect(signed((await send('GET', '/api/inventory')).body.find((i) => i.id === harness.ids.inventory).receipt_url)).toBe(true);
    const row = (await send('GET', '/api/schedule-c?year=2026')).body.rows.find((r) => r.id === expenseId());
    expect([signed(row.receipt_url), row.receipt_private, row.documentation_missing]).toEqual([true, true, false]);
    // No response ever carries the stored reference itself.
    expect(JSON.stringify(receipts)).not.toContain('private:');
  });

  it('hands out a fresh signed link for one receipt, to its owner only', async () => {
    await send('POST', '/api/receipts/attach', { itemType: 'expense', itemId: expenseId(), fileData: 'data:image/png;base64,YWJj' });
    const res = await fetch(`${base}/api/receipts/link?itemType=expense&itemId=${expenseId()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.receipt_private).toBe(true);
    const url = new URL(body.receipt_url);
    expect([url.hostname, url.searchParams.get('type')]).toEqual(['api.cloudinary.com', 'authenticated']);
    // A link that is still good: it expires in the future.
    expect(Number(url.searchParams.get('expires_at'))).toBeGreaterThan(Date.now() / 1000);
    expect(JSON.stringify(body)).not.toContain('private:');

    // An older public receipt comes back as it is.
    harness.db.inventory[0].receipt_url = 'https://res.cloudinary.com/qa/image/upload/old.png';
    expect((await send('GET', `/api/receipts/link?itemType=inventory&itemId=${harness.ids.inventory}`)).body)
      .toEqual({ receipt_url: 'https://res.cloudinary.com/qa/image/upload/old.png', receipt_private: false });

    // No receipt, an unknown record, another user's record, bad input.
    harness.db.inventory[0].receipt_url = null;
    expect((await send('GET', `/api/receipts/link?itemType=inventory&itemId=${harness.ids.inventory}`)).status).toBe(404);
    expect((await send('GET', '/api/receipts/link?itemType=expense&itemId=nope')).status).toBe(404);
    harness.db.expense[0].user_id = 'someone-else';
    expect((await send('GET', `/api/receipts/link?itemType=expense&itemId=${expenseId()}`)).status).toBe(404);
    expect((await send('GET', '/api/receipts/link?itemType=sale&itemId=x')).status).toBe(400);
    expect((await send('GET', '/api/receipts/link?itemType=expense')).status).toBe(400);
    // A reference copied onto another record is never signed.
    harness.db.expense[0].user_id = harness.db.user[0].id;
    harness.db.expense[0].receipt_url = ref('expense', 'someone-elses-expense');
    expect((await send('GET', `/api/receipts/link?itemType=expense&itemId=${expenseId()}`)).status).toBe(404);
    // Signed out.
    const anon = await fetch(`${base}/api/receipts/link?itemType=expense&itemId=${expenseId()}`, { headers: { 'x-qa-unauthenticated': 'true' } });
    expect(anon.status).toBe(401);
  });

  it('refuses a private reference sent by a client, and never signs one copied onto another record', async () => {
    const stolen = ref('expense', 'someone-elses-expense');
    expect((await send('POST', '/api/expenses', { name: 'x', amount: 1, date: '2026-01-01', receipt_url: stolen })).status).toBe(400);
    expect((await send('PUT', `/api/expenses/${expenseId()}`, { receipt_url: stolen })).status).toBe(400);
    // Even if one got into the database somehow, it isn't signed for this record.
    harness.db.expense[0].receipt_url = stolen;
    const shown = (await send('GET', '/api/expenses')).body[0];
    expect([shown.receipt_url, shown.receipt_private]).toEqual([null, true]);
    // Plain https links are still accepted as before.
    expect((await send('PUT', `/api/expenses/${expenseId()}`, { receipt_url: 'https://example.com/r.png' })).status).toBe(200);
  });
});
