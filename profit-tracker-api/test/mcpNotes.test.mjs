import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
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
async function rpc(method, params) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return response.json();
}
async function callTool(name, args = {}) {
  const payload = await rpc('tools/call', { name, arguments: args });
  if (payload.error) return { rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { isError: result.isError || false, data };
}
const rejected = (res) => Boolean(res.rpcError || res.isError);

async function rest(method, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}/api/transaction-notes${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const OTHER_INV = '99999999-9999-4999-8999-0000000000a1';
const OTHER_SALE = '99999999-9999-4999-8999-0000000000a2';
const SECOND_INV = '99999999-9999-4999-8999-0000000000b1';
const MISSING = '99999999-9999-4999-8999-0000000000ff';

// Another user's purchase + sale, and a second purchase of a different product
// for this user, so filters and ownership have something to tell apart.
function seedExtra() {
  harness.db.inventory.push(
    { id: OTHER_INV, user_id: ids.other, product_name: 'QA Multi-unit Sneaker', qty_purchased: 1, qty_on_hand: 0, unit_purchase_cost: 10 },
    { id: SECOND_INV, user_id: ids.user, product_name: 'Console Bundle', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 300 },
  );
  harness.db.sales.push({ id: OTHER_SALE, inventory_id: OTHER_INV, platform_id: ids.foreign, quantity: 1, unit_price: 20, sale_date: new Date('2026-09-05T12:00:00Z') });
}
function seedNote(fields) {
  const now = new Date();
  const note = {
    id: crypto.randomUUID(), user_id: ids.user, entity_type: 'purchase', entity_id: ids.inventory, body: 'seeded',
    author: 'carl', pinned: false, created_at: now, updated_at: now, deleted_at: null, ...fields,
  };
  harness.db.transactionNote.push(note);
  return note;
}

describe('add_note', () => {
  it('adds a bot-authored note to a purchase, logs the write, and records note_added', async () => {
    const { isError, data } = await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: '  Box was dented  ' });
    expect(isError).toBe(false);
    expect(data).toMatchObject({
      entity_type: 'purchase', entity_id: ids.inventory, product: 'QA Multi-unit Sneaker',
      body: 'Box was dented', author: 'bot', pinned: false,
    });
    expect(Object.keys(data)).toEqual(['id', 'entity_type', 'entity_id', 'product', 'body', 'author', 'pinned', 'created_at', 'updated_at']);
    expect(harness.db.transactionNote).toHaveLength(1);
    expect(harness.db.transactionNote[0]).toMatchObject({ user_id: ids.user, author: 'bot', deleted_at: null });
    expect(harness.db.mcpWriteLog.map((l) => l.tool)).toEqual(['add_note']);
    expect(harness.db.changeLog).toEqual([expect.objectContaining({
      table_name: 'Inventory', record_id: ids.inventory, field: 'note_added', old_value: null, new_value: 'Box was dented', source: 'mcp',
    })]);
  });

  it('adds a pinned note to a sale; the product comes via the sale\'s purchase', async () => {
    const { data } = await callTool('add_note', { entity_type: 'sale', entity_id: ids.sale, body: 'Buyer asked for tracking', pinned: true });
    expect(data).toMatchObject({ entity_type: 'sale', entity_id: ids.sale, product: 'QA Multi-unit Sneaker', pinned: true, author: 'bot' });
    expect(harness.db.changeLog[0]).toMatchObject({ table_name: 'Sales', record_id: ids.sale, field: 'note_added' });
  });

  it('rejects another user\'s purchase or sale and writes nothing', async () => {
    seedExtra();
    expect((await callTool('add_note', { entity_type: 'purchase', entity_id: OTHER_INV, body: 'x' })).isError).toBe(true);
    expect((await callTool('add_note', { entity_type: 'sale', entity_id: OTHER_SALE, body: 'x' })).isError).toBe(true);
    // Right id, wrong type: a sale id is not a purchase.
    expect((await callTool('add_note', { entity_type: 'purchase', entity_id: ids.sale, body: 'x' })).isError).toBe(true);
    expect((await callTool('add_note', { entity_type: 'sale', entity_id: MISSING, body: 'x' })).isError).toBe(true);
    expect(harness.db.transactionNote).toEqual([]);
    expect(harness.db.changeLog).toEqual([]);
    expect(harness.db.mcpWriteLog).toEqual([]);
  });

  it('rejects invalid input', async () => {
    expect(rejected(await callTool('add_note', { entity_type: 'expense', entity_id: ids.inventory, body: 'x' }))).toBe(true);
    expect(rejected(await callTool('add_note', { entity_type: 'purchase', entity_id: 'not-a-uuid', body: 'x' }))).toBe(true);
    expect(rejected(await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: '' }))).toBe(true);
    expect(rejected(await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: '   ' }))).toBe(true);
    expect(rejected(await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: 'x'.repeat(2001) }))).toBe(true);
    expect(rejected(await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: 'x', author: 'carl' }))).toBe(true);
    expect(rejected(await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory }))).toBe(true);
    expect(harness.db.transactionNote).toEqual([]);
    // Exactly 2000 characters is allowed.
    expect((await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: 'x'.repeat(2000) })).isError).toBe(false);
  });
});

describe('list_notes', () => {
  it('orders pinned first, then newest first, and returns compact rows', async () => {
    const old = seedNote({ body: 'old', created_at: new Date('2026-10-01T10:00:00Z') });
    const newest = seedNote({ body: 'newest', created_at: new Date('2026-10-20T10:00:00Z') });
    const pinnedOld = seedNote({ body: 'pinned old', pinned: true, created_at: new Date('2026-09-01T10:00:00Z') });
    const mid = seedNote({ entity_type: 'sale', entity_id: ids.sale, body: 'mid', created_at: new Date('2026-10-10T10:00:00Z') });
    const { data } = await callTool('list_notes', {});
    expect(data.notes.map((n) => n.id)).toEqual([pinnedOld.id, newest.id, mid.id, old.id]);
    expect(data).not.toHaveProperty('product_note');
    expect(data.notes[2]).toEqual({
      id: mid.id, entity_type: 'sale', entity_id: ids.sale, product: 'QA Multi-unit Sneaker', body: 'mid',
      author: 'carl', pinned: false, created_at: '2026-10-10T10:00:00.000Z', updated_at: expect.any(String),
    });
  });

  it('filters to one entity and returns that product\'s shared note', async () => {
    harness.db.productNote.push({ id: crypto.randomUUID(), user_id: ids.user, product_name: 'qa multi-unit sneaker', note: 'Runs half a size small' });
    const saleNote = seedNote({ entity_type: 'sale', entity_id: ids.sale, body: 'on the sale' });
    seedNote({ body: 'on the purchase' });
    const { data } = await callTool('list_notes', { entity_type: 'sale', entity_id: ids.sale });
    expect(data.product_note).toBe('Runs half a size small');
    expect(data.notes.map((n) => n.id)).toEqual([saleNote.id]);
  });

  it('returns product_note null when the entity\'s product has no shared note', async () => {
    const { data } = await callTool('list_notes', { entity_type: 'purchase', entity_id: ids.inventory });
    expect(data).toEqual({ product_note: null, notes: [] });
  });

  it('requires entity_type and entity_id together, and rejects another user\'s entity', async () => {
    seedExtra();
    expect((await callTool('list_notes', { entity_type: 'sale' })).isError).toBe(true);
    expect((await callTool('list_notes', { entity_id: ids.sale })).isError).toBe(true);
    expect((await callTool('list_notes', { entity_type: 'purchase', entity_id: OTHER_INV })).isError).toBe(true);
  });

  it('filters by product (case-insensitive partial), covering purchase and sale notes', async () => {
    seedExtra();
    harness.db.productNote.push({ id: crypto.randomUUID(), user_id: ids.user, product_name: 'qa multi-unit sneaker', note: 'Shared sneaker note' });
    const onPurchase = seedNote({ body: 'sneaker purchase', created_at: new Date('2026-10-02T00:00:00Z') });
    const onSale = seedNote({ entity_type: 'sale', entity_id: ids.sale, body: 'sneaker sale', created_at: new Date('2026-10-03T00:00:00Z') });
    seedNote({ entity_id: SECOND_INV, body: 'console' });
    // Another user's note on the same product name must never show up.
    seedNote({ user_id: ids.other, entity_id: OTHER_INV, body: 'other user sneaker' });
    const { data } = await callTool('list_notes', { product: 'SNEAKER' });
    expect(data.notes.map((n) => n.id)).toEqual([onSale.id, onPurchase.id]);
    // Partial match landed on exactly one product, so its shared note comes back.
    expect(data.product_note).toBe('Shared sneaker note');

    const none = await callTool('list_notes', { product: 'nothing like this' });
    expect(none.data).toEqual({ product_note: null, notes: [] });
  });

  it('filters by text and by created date range', async () => {
    seedNote({ body: 'Refund requested', created_at: new Date('2026-10-01T08:00:00Z') });
    const inRange = seedNote({ body: 'refund approved', created_at: new Date('2026-10-15T23:30:00Z') });
    seedNote({ body: 'shipped', created_at: new Date('2026-10-15T12:00:00Z') });
    seedNote({ body: 'late refund', created_at: new Date('2026-10-16T00:00:01Z') });

    const text = await callTool('list_notes', { text: 'REFUND' });
    expect(text.data.notes).toHaveLength(3);

    const dated = await callTool('list_notes', { start_date: '2026-10-15', end_date: '2026-10-15', text: 'refund' });
    expect(dated.data.notes.map((n) => n.id)).toEqual([inRange.id]);

    expect(rejected(await callTool('list_notes', { start_date: '2026-02-30' }))).toBe(true);
  });

  it('defaults to 20 rows and honours an explicit limit within 1..100', async () => {
    for (let i = 0; i < 25; i += 1) seedNote({ body: `n${i}`, created_at: new Date(Date.UTC(2026, 9, 1, 0, i)) });
    expect((await callTool('list_notes', {})).data.notes).toHaveLength(20);
    expect((await callTool('list_notes', { limit: 5 })).data.notes.map((n) => n.body)).toEqual(['n24', 'n23', 'n22', 'n21', 'n20']);
    expect((await callTool('list_notes', { limit: 100 })).data.notes).toHaveLength(25);
    expect(rejected(await callTool('list_notes', { limit: 0 }))).toBe(true);
    expect(rejected(await callTool('list_notes', { limit: 101 }))).toBe(true);
  });

  it('hides soft-deleted notes unless include_deleted is true', async () => {
    const live = seedNote({ body: 'live' });
    const gone = seedNote({ body: 'gone', deleted_at: new Date('2026-10-30T00:00:00Z') });
    expect((await callTool('list_notes', {})).data.notes.map((n) => n.id)).toEqual([live.id]);
    const all = await callTool('list_notes', { include_deleted: true });
    expect(all.data.notes.map((n) => n.id).sort()).toEqual([live.id, gone.id].sort());
    expect(all.data.notes.find((n) => n.id === gone.id).deleted_at).toBe('2026-10-30T00:00:00.000Z');
    expect(all.data.notes.find((n) => n.id === live.id).deleted_at).toBeNull();
  });
});

describe('update_note / delete_note', () => {
  it('edits body and pinned, recording note_body and note_pinned against the parent', async () => {
    const { data: added } = await callTool('add_note', { entity_type: 'sale', entity_id: ids.sale, body: 'first' });
    const { isError, data } = await callTool('update_note', { note_id: added.id, body: ' second ', pinned: true });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ id: added.id, body: 'second', pinned: true, author: 'bot', product: 'QA Multi-unit Sneaker' });
    const fields = harness.db.changeLog.filter((c) => c.field !== 'note_added');
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ table_name: 'Sales', record_id: ids.sale, field: 'note_body', old_value: 'first', new_value: 'second', source: 'mcp' }),
      expect.objectContaining({ table_name: 'Sales', record_id: ids.sale, field: 'note_pinned', old_value: 'false', new_value: 'true', source: 'mcp' }),
    ]));
    expect(harness.db.mcpWriteLog.map((l) => l.tool)).toEqual(['add_note', 'update_note']);
  });

  it('changes only what is given and records nothing when nothing changes', async () => {
    const { data: added } = await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: 'keep me' });
    const { data } = await callTool('update_note', { note_id: added.id, pinned: true });
    expect(data).toMatchObject({ body: 'keep me', pinned: true });
    const before = harness.db.changeLog.length;
    await callTool('update_note', { note_id: added.id, body: 'keep me', pinned: true });
    expect(harness.db.changeLog).toHaveLength(before);
  });

  it('rejects bad update input, unknown notes, deleted notes, and another user\'s note', async () => {
    const { data: added } = await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: 'x' });
    expect((await callTool('update_note', { note_id: added.id })).isError).toBe(true);
    expect(rejected(await callTool('update_note', { note_id: added.id, body: '' }))).toBe(true);
    expect(rejected(await callTool('update_note', { note_id: added.id, body: '  ' }))).toBe(true);
    expect(rejected(await callTool('update_note', { note_id: added.id, body: 'y'.repeat(2001) }))).toBe(true);
    expect(rejected(await callTool('update_note', { note_id: 'nope', body: 'y' }))).toBe(true);
    expect((await callTool('update_note', { note_id: MISSING, body: 'y' })).isError).toBe(true);
    const foreign = seedNote({ user_id: ids.other, body: 'private' });
    expect((await callTool('update_note', { note_id: foreign.id, body: 'hijack' })).isError).toBe(true);
    expect((await callTool('delete_note', { note_id: foreign.id })).isError).toBe(true);
    expect(foreign).toMatchObject({ body: 'private', deleted_at: null });
    const deleted = seedNote({ body: 'old', deleted_at: new Date() });
    expect((await callTool('update_note', { note_id: deleted.id, body: 'revive' })).isError).toBe(true);
    expect(harness.db.transactionNote.find((n) => n.id === added.id).body).toBe('x');
  });

  it('soft-deletes: keeps the row, sets deleted_at, records note_deleted, and cannot delete twice', async () => {
    const { data: added } = await callTool('add_note', { entity_type: 'purchase', entity_id: ids.inventory, body: 'to remove' });
    const { isError, data } = await callTool('delete_note', { note_id: added.id });
    expect(isError).toBe(false);
    expect(data.deleted_at).toEqual(expect.any(String));
    const row = harness.db.transactionNote.find((n) => n.id === added.id);
    expect(row.body).toBe('to remove');
    expect(row.deleted_at).toBeInstanceOf(Date);
    expect(harness.db.changeLog.at(-1)).toMatchObject({ table_name: 'Inventory', record_id: ids.inventory, field: 'note_deleted', old_value: 'to remove', new_value: null });
    expect((await callTool('delete_note', { note_id: added.id })).isError).toBe(true);
    expect((await callTool('list_notes', {})).data.notes).toEqual([]);
  });
});

describe('list_changes shows note activity', () => {
  it('returns every note write for a sale via record_id', async () => {
    const { data: added } = await callTool('add_note', { entity_type: 'sale', entity_id: ids.sale, body: 'a' });
    await callTool('update_note', { note_id: added.id, body: 'b' });
    await callTool('update_note', { note_id: added.id, pinned: true });
    await callTool('delete_note', { note_id: added.id });
    const { data } = await callTool('list_changes', { record_id: ids.sale });
    expect(data.map((c) => c.field).sort()).toEqual(['note_added', 'note_body', 'note_deleted', 'note_pinned']);
    expect(data.every((c) => c.table === 'Sales' && c.source === 'mcp')).toBe(true);
    expect(data.find((c) => c.field === 'note_deleted').old_value).toBe('b');
  });
});

describe('tool listing', () => {
  it('registers the note tools and points the legacy notes params at add_note', async () => {
    const { result } = await rpc('tools/list', {});
    const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]));
    for (const name of ['add_note', 'list_notes', 'update_note', 'delete_note']) expect(byName[name], name).toBeDefined();
    expect(byName.add_note.inputSchema.properties.entity_type.enum).toEqual(['sale', 'purchase']);
    expect(byName.add_note.inputSchema.required.sort()).toEqual(['body', 'entity_id', 'entity_type']);
    expect(byName.list_notes.inputSchema.required ?? []).toEqual([]);
    for (const name of ['update_sale', 'update_purchase', 'add_sale']) {
      expect(byName[name].inputSchema.properties.notes.description, name).toMatch(/add_note/);
    }
    expect(byName.list_changes.description).toMatch(/note/);
  });
});

describe('REST /api/transaction-notes', () => {
  it('creates a carl-authored note with a web-sourced change, and lists it', async () => {
    const created = await rest('POST', '', { entity_type: 'purchase', entity_id: ids.inventory, body: ' From the website ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ entity_type: 'purchase', entity_id: ids.inventory, body: 'From the website', author: 'carl', pinned: false });
    expect(harness.db.changeLog).toEqual([expect.objectContaining({
      table_name: 'Inventory', record_id: ids.inventory, field: 'note_added', new_value: 'From the website', source: 'web',
    })]);
    expect(harness.db.mcpWriteLog).toEqual([]);

    const listed = await rest('GET', `?entity_type=purchase&entity_id=${ids.inventory}`);
    expect(listed.status).toBe(200);
    expect(listed.body.map((n) => n.id)).toEqual([created.body.id]);
  });

  it('lists one entity\'s live notes, pinned first then newest', async () => {
    const older = seedNote({ body: 'older', created_at: new Date('2026-10-01T00:00:00Z') });
    const newer = seedNote({ body: 'newer', created_at: new Date('2026-10-05T00:00:00Z') });
    const pinned = seedNote({ body: 'pinned', pinned: true, created_at: new Date('2026-09-01T00:00:00Z') });
    seedNote({ body: 'deleted', deleted_at: new Date() });
    seedNote({ entity_type: 'sale', entity_id: ids.sale, body: 'other entity' });
    const { status, body } = await rest('GET', `?entity_type=purchase&entity_id=${ids.inventory}`);
    expect(status).toBe(200);
    expect(body.map((n) => n.id)).toEqual([pinned.id, newer.id, older.id]);
  });

  it('edits and soft-deletes with web-sourced change rows', async () => {
    const { body: note } = await rest('POST', '', { entity_type: 'sale', entity_id: ids.sale, body: 'v1' });
    const patched = await rest('PATCH', `/${note.id}`, { body: 'v2', pinned: true });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ body: 'v2', pinned: true, author: 'carl' });
    const removed = await rest('DELETE', `/${note.id}`);
    expect(removed).toEqual({ status: 200, body: { success: true } });
    expect(harness.db.transactionNote.find((n) => n.id === note.id).deleted_at).toBeInstanceOf(Date);
    expect(harness.db.changeLog.map((c) => [c.table_name, c.record_id, c.field, c.source])).toEqual([
      ['Sales', ids.sale, 'note_added', 'web'],
      ['Sales', ids.sale, 'note_body', 'web'],
      ['Sales', ids.sale, 'note_pinned', 'web'],
      ['Sales', ids.sale, 'note_deleted', 'web'],
    ]);
    expect((await rest('DELETE', `/${note.id}`)).status).toBe(404);
    expect((await rest('PATCH', `/${note.id}`, { body: 'v3' })).status).toBe(404);
    expect((await rest('GET', `?entity_type=sale&entity_id=${ids.sale}`)).body).toEqual([]);
  });

  it('validates input with 400s and writes nothing', async () => {
    const bad = [
      {},
      { entity_type: 'expense', entity_id: ids.inventory, body: 'x' },
      { entity_type: 'purchase', entity_id: 'not-a-uuid', body: 'x' },
      { entity_type: 'purchase', entity_id: ids.inventory },
      { entity_type: 'purchase', entity_id: ids.inventory, body: '   ' },
      { entity_type: 'purchase', entity_id: ids.inventory, body: 42 },
      { entity_type: 'purchase', entity_id: ids.inventory, body: 'x'.repeat(2001) },
      { entity_type: 'purchase', entity_id: ids.inventory, body: 'x', pinned: 'yes' },
    ];
    for (const payload of bad) expect((await rest('POST', '', payload)).status, JSON.stringify(payload).slice(0, 80)).toBe(400);
    expect((await rest('GET', '')).status).toBe(400);
    expect((await rest('GET', `?entity_type=purchase&entity_id=nope`)).status).toBe(400);
    const note = seedNote({ body: 'keep' });
    expect((await rest('PATCH', `/${note.id}`, {})).status).toBe(400);
    expect((await rest('PATCH', `/${note.id}`, { body: '' })).status).toBe(400);
    expect((await rest('PATCH', `/${note.id}`, { pinned: 'true' })).status).toBe(400);
    expect((await rest('PATCH', '/not-a-uuid', { body: 'y' })).status).toBe(400);
    expect((await rest('DELETE', '/not-a-uuid')).status).toBe(400);
    expect(note).toMatchObject({ body: 'keep', pinned: false, deleted_at: null });
    expect(harness.db.transactionNote).toHaveLength(1);
    expect(harness.db.changeLog).toEqual([]);
  });

  it('enforces ownership with 404s', async () => {
    seedExtra();
    expect((await rest('POST', '', { entity_type: 'purchase', entity_id: OTHER_INV, body: 'x' })).status).toBe(404);
    expect((await rest('POST', '', { entity_type: 'sale', entity_id: OTHER_SALE, body: 'x' })).status).toBe(404);
    expect((await rest('POST', '', { entity_type: 'sale', entity_id: MISSING, body: 'x' })).status).toBe(404);
    expect((await rest('GET', `?entity_type=sale&entity_id=${OTHER_SALE}`)).status).toBe(404);
    const foreign = seedNote({ user_id: ids.other, entity_id: OTHER_INV, body: 'private' });
    expect((await rest('PATCH', `/${foreign.id}`, { body: 'hijack' })).status).toBe(404);
    expect((await rest('DELETE', `/${foreign.id}`)).status).toBe(404);
    expect(foreign).toMatchObject({ body: 'private', deleted_at: null });
    expect(harness.db.changeLog).toEqual([]);
  });

  it('requires a signed-in user', async () => {
    const res = await rest('GET', `?entity_type=purchase&entity_id=${ids.inventory}`, undefined, { 'x-qa-unauthenticated': 'true' });
    expect(res.status).toBe(401);
  });

  it('rolls back the note when the change log write fails', async () => {
    harness.faults['changeLog.createMany'] = true;
    const res = await rest('POST', '', { entity_type: 'purchase', entity_id: ids.inventory, body: 'x' });
    expect(res.status).toBe(500);
    expect(harness.db.transactionNote).toEqual([]);
  });
});

// ------------------------------------------------------------------ migration

const migrationUrl = new URL('../prisma/migrations/20261031000000_add_transaction_notes/migration.sql', import.meta.url);

describe('add_transaction_notes migration SQL (text)', () => {
  it('backfills from both Inventory and Sales and drops nothing', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(code).toMatch(/INSERT INTO "TransactionNote"[\s\S]*?FROM "Inventory" i\b/);
    expect(code).toMatch(/INSERT INTO "TransactionNote"[\s\S]*?FROM "Sales" s\s+JOIN "Inventory" i ON i\."id" = s\."inventory_id"/);
    expect(code.match(/INSERT INTO "TransactionNote"/g)).toHaveLength(2);
    expect(code).toMatch(/gen_random_uuid\(\)::text/);
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/ALTER TABLE "(Inventory|Sales|ProductNote)"/);
    expect(code).not.toMatch(/ProductNote/);
  });
});

describe('add_transaction_notes migration SQL in an isolated PostgreSQL engine', () => {
  let pg;
  let client;
  beforeAll(async () => {
    const socket = createServer(); await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
    const directory = await mkdtemp(join(tmpdir(), 'profittracker-transaction-notes-qa-'));
    pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: true, onLog: () => {}, onError: () => {} });
    await pg.initialise(); await pg.start(); await pg.createDatabase('transaction_notes_qa');
    client = new Client({ connectionString: `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/transaction_notes_qa` });
    await client.connect();
  }, 60000);
  afterAll(async () => { if (client) await client.end(); if (pg) await pg.stop(); });

  it('creates the table and copies only non-blank legacy notes, owner taken from the purchase', async () => {
    await client.query(`
      CREATE TABLE "User" (id TEXT PRIMARY KEY);
      CREATE TABLE "Inventory" (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "User"(id), product_name TEXT NOT NULL, notes TEXT);
      CREATE TABLE "Sales" (id TEXT PRIMARY KEY, inventory_id TEXT NOT NULL REFERENCES "Inventory"(id), notes TEXT);
      INSERT INTO "User" VALUES ('u1'), ('u2');
      INSERT INTO "Inventory" VALUES
        ('inv-note', 'u1', 'Sneaker', '  dented box  '),
        ('inv-null', 'u1', 'Sneaker', NULL),
        ('inv-blank', 'u2', 'Console', E' \\n\\t '),
        ('inv-u2', 'u2', 'Console', 'u2 purchase note');
      INSERT INTO "Sales" VALUES
        ('sale-note', 'inv-u2', 'buyer paid late'),
        ('sale-empty', 'inv-note', ''),
        ('sale-null', 'inv-note', NULL);`);
    await client.query(await readFile(migrationUrl, 'utf8'));

    const { rows } = await client.query('SELECT * FROM "TransactionNote" ORDER BY entity_id');
    expect(rows.map((r) => [r.user_id, r.entity_type, r.entity_id, r.body, r.author, r.pinned, r.deleted_at])).toEqual([
      ['u1', 'purchase', 'inv-note', 'dented box', 'bot', false, null],
      ['u2', 'purchase', 'inv-u2', 'u2 purchase note', 'bot', false, null],
      ['u2', 'sale', 'sale-note', 'buyer paid late', 'bot', false, null],
    ]);
    for (const row of rows) {
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.updated_at).toBeInstanceOf(Date);
    }
    // Legacy columns are untouched.
    const legacy = await client.query('SELECT id, notes FROM "Inventory" ORDER BY id');
    expect(legacy.rows.find((r) => r.id === 'inv-note').notes).toBe('  dented box  ');
    const sales = await client.query('SELECT notes FROM "Sales" WHERE id = $1', ['sale-note']);
    expect(sales.rows[0].notes).toBe('buyer paid late');

    // Defaults and the user FK (ON DELETE CASCADE) are in place.
    await client.query(`INSERT INTO "TransactionNote" (id, user_id, entity_type, entity_id, body, updated_at) VALUES ('n1', 'u1', 'sale', 'x', 'hi', now())`);
    const fresh = await client.query(`SELECT author, pinned, deleted_at FROM "TransactionNote" WHERE id = 'n1'`);
    expect(fresh.rows[0]).toEqual({ author: 'carl', pinned: false, deleted_at: null });
    await expect(client.query(`INSERT INTO "TransactionNote" (id, user_id, entity_type, entity_id, body, updated_at) VALUES ('n2', 'nobody', 'sale', 'x', 'hi', now())`)).rejects.toThrow();
    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'TransactionNote' ORDER BY indexname`);
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'TransactionNote_pkey',
      'TransactionNote_user_id_created_at_idx',
      'TransactionNote_user_id_entity_type_entity_id_idx',
    ]);
  });
});
