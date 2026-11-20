// Activity phase 2 through the real routes against a throwaway Postgres:
// cashout connections (the key never logged; undo brings a connection back
// with its commitments and item matches but without the key), calendar
// events, product and purchase/sale notes, and the log-only entries (API keys,
// the Schedule C switch, data reset) that undo refuses.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const ME = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let pg;
let db;
let server;
let baseUrl;
let currentUser = ME;
let encryptKey;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

beforeAll(async () => {
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-activity-setup2-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('activity_setup2_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/activity_setup2_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };
  ({ encryptKey } = require('../services/cashouts/crypto'));

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: currentUser }; next(); });
  app.use('/api/cashouts', require('../routes/cashouts'));
  app.use('/api/calendar-events', require('../routes/calendarEvents'));
  app.use('/api/product-notes', require('../routes/productNotes'));
  app.use('/api/transaction-notes', require('../routes/transactionNotes'));
  app.use('/api/api-keys', require('../routes/apiKeys'));
  app.use('/api/preferences', require('../routes/preferences'));
  app.use('/api/data-reset', require('../routes/dataReset'));
  app.use('/api/activity', require('../routes/activity'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 180000);

afterAll(async () => {
  if (server) server.close();
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

const call = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const undo = (id) => call('POST', `/api/activity/${id}/undo`);
const latest = () => db.activityLog.findFirst({ where: { user_id: ME }, orderBy: { created_at: 'desc' } });

let ids;
beforeEach(async () => {
  currentUser = ME;
  await db.$executeRaw`TRUNCATE "User" CASCADE`;
  await db.user.create({ data: { id: ME, username: 'setup2-qa', email: 'setup2-qa@example.invalid' } });
  await db.user.create({ data: { id: OTHER, username: 'setup2-qa-2', email: 'setup2-qa-2@example.invalid' } });
  const platform = await db.platform.create({ data: { user_id: ME, name: 'Cashout co', type: 'Cashout', fee_pct: 0 } });
  const purchase = await db.inventory.create({
    data: { user_id: ME, product_name: 'Switch 2', purchase_date: new Date('2026-10-01T12:00:00Z'), unit_purchase_cost: 400, qty_purchased: 1, qty_on_hand: 0, receiving_status: 'ON_HAND' },
  });
  const sale = await db.sales.create({
    data: { inventory_id: purchase.id, quantity: 1, unit_price: 450, sale_date: new Date('2026-10-02T12:00:00Z'), status: 'PAID', workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'PAID', platform_id: platform.id },
  });
  const connection = await db.cashoutConnection.create({
    data: { user_id: ME, provider: 'eb', display_name: 'My EB', encrypted_key: encryptKey('live_test_key_1234'), key_last4: '1234', platform_id: platform.id },
  });
  const commitment = await db.cashoutCommitment.create({
    data: { user_id: ME, connection_id: connection.id, sale_id: sale.id, external_deal_id: 'deal-1', external_item_id: 'item-1', quantity: 1, status: 'active' },
  });
  const match = await db.cashoutItemMatch.create({
    data: { user_id: ME, connection_id: connection.id, provider: 'eb', external_deal_id: 'deal-1', deal_item_name: 'Switch 2', inventory_id: purchase.id },
  });
  ids = { platform: platform.id, purchase: purchase.id, sale: sale.id, connection: connection.id, commitment: commitment.id, match: match.id };
});

describe('cashout connections', () => {
  it('removing one logs its commitments and matches but never the key; undo brings them back, key needed', async () => {
    const removed = await call('DELETE', `/api/cashouts/connections/${ids.connection}`);
    expect(removed.status).toBe(200);
    expect(await db.cashoutCommitment.count({ where: { id: ids.commitment } })).toBe(0);
    const entry = await db.activityLog.findUnique({ where: { id: removed.body.activity_id } });
    expect(entry).toMatchObject({ record_type: 'cashout_connection', record_id: ids.connection });
    expect(entry.detail.product_name).toBe('My EB');
    expect(JSON.stringify(entry.detail)).not.toContain('encrypted_key');
    expect(entry.detail.rows.map((r) => r.model).sort()).toEqual(['cashoutCommitment', 'cashoutConnection', 'cashoutItemMatch']);

    const undone = await undo(entry.id);
    expect(undone.status).toBe(200);
    expect(undone.body.entry.detail.key_needed).toBe(true);
    const back = await db.cashoutConnection.findUnique({ where: { id: ids.connection } });
    expect(back).toMatchObject({ display_name: 'My EB', platform_id: ids.platform, status: 'attention_needed', encrypted_key: '', key_last4: '1234' });
    expect(await db.cashoutCommitment.findUnique({ where: { id: ids.commitment } })).toMatchObject({ sale_id: ids.sale, status: 'active' });
    expect(await db.cashoutItemMatch.count({ where: { id: ids.match } })).toBe(1);

    // Undoing the undo removes it again, even though sync marked it differently.
    await db.cashoutConnection.update({ where: { id: ids.connection }, data: { last_error: 'Invalid encrypted key payload format.' } });
    expect((await undo(undone.body.entry.id)).status).toBe(200);
    expect(await db.cashoutConnection.count({ where: { id: ids.connection } })).toBe(0);
  });

  it('a rename is logged and undone; another user cannot remove it', async () => {
    const renamed = await call('PATCH', `/api/cashouts/connections/${ids.connection}`, { display_name: 'EB main' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.activity_id).toBeTruthy();
    expect((await undo(renamed.body.activity_id)).status).toBe(200);
    expect((await db.cashoutConnection.findUnique({ where: { id: ids.connection } })).display_name).toBe('My EB');

    currentUser = OTHER;
    expect((await call('DELETE', `/api/cashouts/connections/${ids.connection}`)).status).toBe(404);
    expect(await db.cashoutConnection.count({ where: { id: ids.connection } })).toBe(1);
  });
});

describe('calendar events and notes', () => {
  it('calendar event add, edit and remove are logged and undone', async () => {
    const added = await call('POST', '/api/calendar-events', { title: 'Restock drop', date: '2026-12-01' });
    expect(added.status).toBe(201);
    const edited = await call('PUT', `/api/calendar-events/${added.body.id}`, { title: 'Restock drop (moved)', date: '2026-12-02' });
    const removed = await call('DELETE', `/api/calendar-events/${added.body.id}`);
    expect(await db.activityLog.count({ where: { record_type: 'calendar_event' } })).toBe(3);
    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect((await undo(edited.body.activity_id)).status).toBe(200);
    expect(await db.calendarEvent.findUnique({ where: { id: added.body.id } })).toMatchObject({ title: 'Restock drop', date: '2026-12-01' });
  });

  it('a product note save and removal are logged under the product and undone', async () => {
    const saved = await call('PUT', '/api/product-notes', { product_name: 'Switch 2', note: 'Ask for price match' });
    const entry = await db.activityLog.findUnique({ where: { id: saved.body.activity_id } });
    expect(entry).toMatchObject({ record_type: 'product_note' });
    expect(entry.detail).toMatchObject({ action: 'create', product_name: 'Switch 2' });
    const edited = await call('PUT', '/api/product-notes', { product_name: 'switch 2', note: 'Price matched' });
    expect((await db.activityLog.findUnique({ where: { id: edited.body.activity_id } })).detail.action).toBe('edit');
    const removed = await call('DELETE', '/api/product-notes?product_name=Switch%202');
    expect(removed.body.activity_id).toBeTruthy();
    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect((await db.productNote.findFirst({ where: { user_id: ME } })).note).toBe('Price matched');
    // Removing a note that doesn't exist logs nothing.
    expect((await call('DELETE', '/api/product-notes?product_name=Nothing')).body.activity_id).toBeNull();
  });

  it('a purchase note is logged under its product; deleting and undoing brings it back', async () => {
    const added = await call('POST', '/api/transaction-notes', { entity_type: 'purchase', entity_id: ids.purchase, body: 'Box dented' });
    expect(added.status).toBe(201);
    const addEntry = await latest();
    expect(addEntry).toMatchObject({ record_type: 'transaction_note', record_id: added.body.id });
    expect(addEntry.detail.product_name).toBe('Switch 2');
    await call('DELETE', `/api/transaction-notes/${added.body.id}`);
    const delEntry = await latest();
    expect(delEntry.detail.action).toBe('delete');
    expect((await undo(delEntry.id)).status).toBe(200);
    expect((await db.transactionNote.findUnique({ where: { id: added.body.id } })).deleted_at).toBeNull();
  });
});

describe('log-only entries', () => {
  it('API key create, cashout-writes switch and revoke are logged without the token, and cannot be undone', async () => {
    const created = await call('POST', '/api/api-keys', { name: 'Claude' });
    expect(created.status).toBe(200);
    await call('PATCH', `/api/api-keys/${created.body.id}`, { allow_cashout_writes: true });
    await call('PATCH', `/api/api-keys/${created.body.id}`, { allow_cashout_writes: true });
    await call('DELETE', `/api/api-keys/${created.body.id}`);
    const entries = await db.activityLog.findMany({ where: { record_type: 'api_key' }, orderBy: { created_at: 'asc' } });
    expect(entries.map((e) => e.detail.action)).toEqual(['create', 'cashout_writes', 'revoke']);
    expect(JSON.stringify(entries)).not.toContain(created.body.token);
    const refused = await undo(entries[0].id);
    expect(refused.status).toBe(409);
    const listed = await call('GET', '/api/activity?group=setup');
    expect(listed.body.entries.every((e) => e.undo_state === 'not_undoable')).toBe(true);
  });

  it('the Schedule C switch is logged only when it changes', async () => {
    await call('PUT', '/api/preferences/schedule-c', { enabled: true });
    await call('PUT', '/api/preferences/schedule-c', { enabled: true });
    await call('PUT', '/api/preferences/schedule-c', { enabled: false });
    const entries = await db.activityLog.findMany({ where: { record_type: 'setting' }, orderBy: { created_at: 'asc' } });
    expect(entries.map((e) => e.detail.enabled)).toEqual([true, false]);
  });

  it('a full data reset clears undo history and logs the reset; a purchases reset keeps setup history', async () => {
    await call('POST', '/api/calendar-events', { title: 'Kept', date: '2026-12-01' });
    await call('POST', '/api/transaction-notes', { entity_type: 'purchase', entity_id: ids.purchase, body: 'Gone' });
    const partial = await call('POST', '/api/data-reset', { scope: 'transactions', confirmation: 'RESET' });
    expect(partial.status).toBe(200);
    expect((await db.activityLog.findMany({ where: { user_id: ME } })).map((e) => e.record_type).sort()).toEqual(['calendar_event', 'data_reset']);

    const full = await call('POST', '/api/data-reset', { scope: 'everything', confirmation: 'RESET' });
    expect(full.status).toBe(200);
    const left = await db.activityLog.findMany({ where: { user_id: ME } });
    expect(left.map((e) => [e.record_type, e.detail.action])).toEqual([['data_reset', 'everything']]);
    expect((await undo(left[0].id)).status).toBe(409);
  });
});
