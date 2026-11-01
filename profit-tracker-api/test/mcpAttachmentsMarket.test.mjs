import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

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
const rejected = (res) => Boolean(res.rpcError || res.isError);

const OTHER_INV = '99999999-9999-4999-8999-0000000000a1';
const OTHER_SALE = '99999999-9999-4999-8999-0000000000a2';
const SECOND_INV = '99999999-9999-4999-8999-0000000000b1';

function seedOther() {
  harness.db.inventory.push({ id: OTHER_INV, user_id: ids.other, product_name: 'Other Item', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 10 });
  harness.db.sales.push({ id: OTHER_SALE, inventory_id: OTHER_INV, platform_id: ids.foreign, quantity: 1, unit_price: 20, sale_date: new Date('2026-09-05T12:00:00Z') });
}

// ------------------------------------------------------------ attachments

describe('add_attachment', () => {
  it('attaches a link to a purchase, records attachment_added, and logs the write', async () => {
    const url = 'https://example.com/receipts/123';
    const { isError, data } = await callTool('add_attachment', { entity_type: 'purchase', entity_id: ids.inventory, url, label: 'Order receipt', kind: 'receipt' });
    expect(isError).toBe(false);
    expect(Object.keys(data)).toEqual(['id', 'entity_type', 'entity_id', 'url', 'label', 'kind', 'created_at']);
    expect(data).toMatchObject({ entity_type: 'purchase', entity_id: ids.inventory, url, label: 'Order receipt', kind: 'receipt' });
    expect(harness.db.attachment).toHaveLength(1);
    expect(harness.db.attachment[0]).toMatchObject({ user_id: ids.user, url });
    expect(harness.db.changeLog).toEqual([expect.objectContaining({
      table_name: 'Inventory', record_id: ids.inventory, field: 'attachment_added', old_value: null, new_value: url, source: 'mcp',
    })]);
    expect(harness.db.mcpWriteLog.map((l) => l.tool)).toEqual(['add_attachment']);
  });

  it('attaches to a sale and records the change against Sales', async () => {
    const { data } = await callTool('add_attachment', { entity_type: 'sale', entity_id: ids.sale, url: 'https://example.com/x' });
    expect(data).toMatchObject({ entity_type: 'sale', entity_id: ids.sale, label: null, kind: 'other' });
    expect(harness.db.changeLog[0]).toMatchObject({ table_name: 'Sales', record_id: ids.sale, field: 'attachment_added' });
  });

  it('infers kind when omitted', async () => {
    const add = async (url, label) => (await callTool('add_attachment', { entity_type: 'purchase', entity_id: ids.inventory, url, ...(label ? { label } : {}) })).data.kind;
    expect(await add('https://mail.google.com/mail/u/0/#inbox/FMfcgz')).toBe('gmail');
    expect(await add('https://cdn.example.com/files/shipping-label-1.pdf')).toBe('label');
    expect(await add('https://cdn.example.com/files/abc.pdf', 'USPS Label')).toBe('label');
    expect(await add('https://cdn.example.com/files/invoice.pdf')).toBe('other');
    expect(await add('https://example.com/labels/page')).toBe('other');
    // An explicit kind always wins over inference.
    const explicit = await callTool('add_attachment', { entity_type: 'purchase', entity_id: ids.inventory, url: 'https://mail.google.com/mail/u/0/#inbox/2', kind: 'receipt' });
    expect(explicit.data.kind).toBe('receipt');
  });

  it('rejects non-http(s) urls and invalid input, writing nothing', async () => {
    const base = { entity_type: 'purchase', entity_id: ids.inventory };
    expect(rejected(await callTool('add_attachment', { ...base, url: 'javascript:alert(1)' }))).toBe(true);
    expect(rejected(await callTool('add_attachment', { ...base, url: 'ftp://example.com/file.pdf' }))).toBe(true);
    expect(rejected(await callTool('add_attachment', { ...base, url: 'not a url' }))).toBe(true);
    expect(rejected(await callTool('add_attachment', { ...base, url: `https://example.com/${'a'.repeat(2000)}` }))).toBe(true);
    expect(rejected(await callTool('add_attachment', { ...base, url: 'https://example.com', label: 'x'.repeat(201) }))).toBe(true);
    expect(rejected(await callTool('add_attachment', { ...base, url: 'https://example.com', kind: 'photo' }))).toBe(true);
    expect(rejected(await callTool('add_attachment', { entity_type: 'expense', entity_id: ids.inventory, url: 'https://example.com' }))).toBe(true);
    expect(rejected(await callTool('add_attachment', { ...base, entity_id: 'nope', url: 'https://example.com' }))).toBe(true);
    expect(harness.db.attachment).toEqual([]);
    expect(harness.db.changeLog).toEqual([]);
  });

  it('rejects an exact duplicate url on the same record, but allows it on another record', async () => {
    const url = 'https://example.com/same';
    expect((await callTool('add_attachment', { entity_type: 'purchase', entity_id: ids.inventory, url })).isError).toBe(false);
    const dup = await callTool('add_attachment', { entity_type: 'purchase', entity_id: ids.inventory, url });
    expect(dup.isError).toBe(true);
    expect(dup.data).toMatch(/already attached/);
    expect((await callTool('add_attachment', { entity_type: 'sale', entity_id: ids.sale, url })).isError).toBe(false);
    expect(harness.db.attachment).toHaveLength(2);
    expect(harness.db.changeLog).toHaveLength(2);
  });

  it('rejects another user\'s purchase or sale and writes nothing', async () => {
    seedOther();
    expect((await callTool('add_attachment', { entity_type: 'purchase', entity_id: OTHER_INV, url: 'https://example.com' })).isError).toBe(true);
    expect((await callTool('add_attachment', { entity_type: 'sale', entity_id: OTHER_SALE, url: 'https://example.com' })).isError).toBe(true);
    expect((await callTool('add_attachment', { entity_type: 'purchase', entity_id: ids.sale, url: 'https://example.com' })).isError).toBe(true);
    expect(harness.db.attachment).toEqual([]);
    expect(harness.db.changeLog).toEqual([]);
    expect(harness.db.mcpWriteLog).toEqual([]);
  });
});

describe('list_attachments', () => {
  function seedAttachments(n, fields = {}) {
    for (let i = 0; i < n; i += 1) {
      harness.db.attachment.push({
        id: crypto.randomUUID(), user_id: ids.user, entity_type: 'purchase', entity_id: ids.inventory,
        url: `https://example.com/${i}`, label: null, kind: 'other', created_at: new Date(Date.UTC(2026, 9, 1, 0, i)), ...fields,
      });
    }
  }

  it('lists newest first with compact rows and a default limit of 20', async () => {
    seedAttachments(25);
    const { data } = await callTool('list_attachments');
    expect(data).toHaveLength(20);
    expect(data[0].url).toBe('https://example.com/24');
    expect(data[19].url).toBe('https://example.com/5');
    expect(Object.keys(data[0])).toEqual(['id', 'entity_type', 'entity_id', 'url', 'label', 'kind', 'created_at']);
    expect((await callTool('list_attachments', { limit: 3 })).data.map((a) => a.url)).toEqual(['https://example.com/24', 'https://example.com/23', 'https://example.com/22']);
    expect(rejected(await callTool('list_attachments', { limit: 0 }))).toBe(true);
    expect(rejected(await callTool('list_attachments', { limit: 101 }))).toBe(true);
  });

  it('filters to one record, needs entity_type and entity_id together, and hides other users\' rows', async () => {
    seedOther();
    seedAttachments(2);
    harness.db.attachment.push({ id: crypto.randomUUID(), user_id: ids.user, entity_type: 'sale', entity_id: ids.sale, url: 'https://example.com/sale', label: null, kind: 'other', created_at: new Date() });
    harness.db.attachment.push({ id: crypto.randomUUID(), user_id: ids.other, entity_type: 'purchase', entity_id: OTHER_INV, url: 'https://example.com/private', label: null, kind: 'other', created_at: new Date() });

    const all = (await callTool('list_attachments')).data;
    expect(all.map((a) => a.url)).not.toContain('https://example.com/private');
    expect(all).toHaveLength(3);
    const sale = (await callTool('list_attachments', { entity_type: 'sale', entity_id: ids.sale })).data;
    expect(sale.map((a) => a.url)).toEqual(['https://example.com/sale']);
    expect((await callTool('list_attachments', { entity_type: 'sale' })).isError).toBe(true);
    expect((await callTool('list_attachments', { entity_id: ids.sale })).isError).toBe(true);
    expect((await callTool('list_attachments', { entity_type: 'purchase', entity_id: OTHER_INV })).isError).toBe(true);
  });

  it('lists what add_attachment created', async () => {
    await callTool('add_attachment', { entity_type: 'purchase', entity_id: ids.inventory, url: 'https://example.com/a' });
    const { data } = await callTool('list_attachments', { entity_type: 'purchase', entity_id: ids.inventory });
    expect(data).toEqual([expect.objectContaining({ url: 'https://example.com/a', kind: 'other' })]);
  });
});

// ----------------------------------------------------------- market value

// Fixture purchase: batch cost 520 for 5 units (104/unit), 3 on hand -> 312.
describe('set_market_value', () => {
  it('sets the value, records each changed field, and reports unrealized profit', async () => {
    const { isError, data } = await callTool('set_market_value', { purchase_id: ids.inventory, market_value: 150, market_source: 'eBay sold comps', checked_at: '2026-10-30' });
    expect(isError).toBe(false);
    expect(data).toEqual({
      id: ids.inventory, item: 'QA Multi-unit Sneaker', qty_on_hand: 3, market_value: 150, market_source: 'eBay sold comps',
      market_checked_at: '2026-10-30', unit_cost_basis: 104, unrealized_profit: 138,
    });
    expect(harness.db.inventory[0]).toMatchObject({ market_value: '150.00', market_source: 'eBay sold comps' });
    expect(harness.db.changeLog.map((c) => [c.table_name, c.record_id, c.field, c.old_value, c.new_value])).toEqual([
      ['Inventory', ids.inventory, 'market_value', null, '150.00'],
      ['Inventory', ids.inventory, 'market_source', null, 'eBay sold comps'],
      ['Inventory', ids.inventory, 'market_checked_at', null, '2026-10-30'],
    ]);
    expect(harness.db.mcpWriteLog.map((l) => l.tool)).toEqual(['set_market_value']);
  });

  it('defaults checked_at to today, keeps the source, and only logs fields that changed', async () => {
    await callTool('set_market_value', { purchase_id: ids.inventory, market_value: 150, market_source: 'StockX', checked_at: '2026-10-01' });
    harness.db.changeLog.length = 0;
    const { data } = await callTool('set_market_value', { purchase_id: ids.inventory, market_value: 99.5 });
    const today = new Date().toISOString().slice(0, 10);
    expect(data).toMatchObject({ market_value: 99.5, market_source: 'StockX', market_checked_at: today, unrealized_profit: -13.5 });
    expect(harness.db.changeLog.map((c) => c.field)).toEqual(['market_value', 'market_checked_at']);
  });

  it('clears all market fields with null', async () => {
    await callTool('set_market_value', { purchase_id: ids.inventory, market_value: 150, market_source: 'StockX', checked_at: '2026-10-01' });
    harness.db.changeLog.length = 0;
    const { data } = await callTool('set_market_value', { purchase_id: ids.inventory, market_value: null });
    expect(data).toMatchObject({ market_value: null, market_source: null, market_checked_at: null, unit_cost_basis: 104, unrealized_profit: null });
    expect(harness.db.inventory[0]).toMatchObject({ market_value: null, market_source: null, market_checked_at: null });
    expect(harness.db.changeLog.map((c) => [c.field, c.old_value, c.new_value])).toEqual([
      ['market_value', '150.00', null], ['market_source', 'StockX', null], ['market_checked_at', '2026-10-01', null],
    ]);
  });

  it('rejects another user\'s purchase and invalid input', async () => {
    seedOther();
    expect((await callTool('set_market_value', { purchase_id: OTHER_INV, market_value: 5 })).isError).toBe(true);
    expect(rejected(await callTool('set_market_value', { purchase_id: ids.inventory, market_value: -1 }))).toBe(true);
    expect(rejected(await callTool('set_market_value', { purchase_id: ids.inventory }))).toBe(true);
    expect(rejected(await callTool('set_market_value', { purchase_id: ids.inventory, market_value: 1, market_source: 'x'.repeat(101) }))).toBe(true);
    expect(rejected(await callTool('set_market_value', { purchase_id: ids.inventory, market_value: 1, checked_at: '2026-02-30' }))).toBe(true);
    expect(harness.db.changeLog).toEqual([]);
    expect(harness.db.inventory.find((i) => i.id === OTHER_INV).market_value).toBeUndefined();
  });

  it('shows market_value on list_inventory rows (null when unset)', async () => {
    let rows = (await callTool('list_inventory')).data.items;
    expect(rows[0].market_value).toBeNull();
    await callTool('set_market_value', { purchase_id: ids.inventory, market_value: 120.25 });
    rows = (await callTool('list_inventory')).data.items;
    expect(rows[0].market_value).toBe(120.25);
  });
});

describe('get_cashflow_summary market fields', () => {
  it('adds market fields for one priced and one unpriced purchase without changing existing fields', async () => {
    const before = (await callTool('get_cashflow_summary')).data;

    // Unpriced live purchase, plus rows that must be ignored: a cancelled
    // priced one and a priced one with nothing on hand.
    harness.db.inventory.push(
      { id: SECOND_INV, user_id: ids.user, product_name: 'Console Bundle', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 300, status: 'PURCHASED' },
      { id: crypto.randomUUID(), user_id: ids.user, product_name: 'Cancelled', qty_purchased: 2, qty_on_hand: 2, unit_purchase_cost: 10, status: 'CANCELLED', cancelled_at: new Date(), market_value: '50.00' },
      { id: crypto.randomUUID(), user_id: ids.user, product_name: 'Sold out', qty_purchased: 1, qty_on_hand: 0, unit_purchase_cost: 10, status: 'PURCHASED', market_value: '50.00' },
    );
    harness.db.inventory[0].market_value = '150.00';

    const after = (await callTool('get_cashflow_summary')).data;
    expect(after).toMatchObject({
      market_value_on_hand: 450,
      priced_cost_basis: 312,
      unrealized_profit: 138,
      unpriced_items: 1,
    });

    // Existing fields: same values as computing them without any market data.
    for (const inv of harness.db.inventory) delete inv.market_value;
    const unpricedRun = (await callTool('get_cashflow_summary')).data;
    for (const key of ['owed_to_me', 'coming_back', 'spent', 'on_hand_value', 'by_buyer']) {
      expect(after[key]).toEqual(unpricedRun[key]);
    }
    expect(unpricedRun).toMatchObject({ market_value_on_hand: 0, priced_cost_basis: 0, unrealized_profit: 0, unpriced_items: 2 });
  });

  it('keeps the original fields and their values on the base fixture', async () => {
    const { data } = await callTool('get_cashflow_summary');
    expect(Object.keys(data)).toEqual([
      'owed_to_me', 'coming_back', 'spent', 'on_hand_value', 'by_buyer',
      'market_value_on_hand', 'priced_cost_basis', 'unrealized_profit', 'unpriced_items',
    ]);
    expect(data.spent).toBe(520);
    expect(data.on_hand_value).toBe(312);
    expect(data).toMatchObject({ market_value_on_hand: 0, priced_cost_basis: 0, unrealized_profit: 0, unpriced_items: 1 });
  });
});

// ------------------------------------------------------------------ migration

describe('add_attachments_and_market_value migration SQL', () => {
  it('only creates or adds, never drops, renames, or alters existing columns', async () => {
    const sql = await readFile(new URL('../prisma/migrations/20261031020000_add_attachments_and_market_value/migration.sql', import.meta.url), 'utf8');
    const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    // ON DELETE/ON UPDATE are FK actions, not statements.
    expect(code.replace(/ON (DELETE|UPDATE) CASCADE/g, '')).not.toMatch(/\b(DROP|RENAME|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
    const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(4);
    for (const stmt of statements) expect(stmt).toMatch(/^(CREATE TABLE|CREATE INDEX|ALTER TABLE "\w+" ADD )/);
    expect(code).not.toMatch(/ALTER COLUMN/i);
    expect(code).toMatch(/CREATE TABLE "Attachment"/);
    expect(code).toMatch(/CREATE INDEX "Attachment_user_id_entity_type_entity_id_idx"/);
    expect(code).toMatch(/ADD COLUMN "market_value" DECIMAL\(19,2\)/);
    expect(code).toMatch(/ADD COLUMN "market_source" TEXT/);
    expect(code).toMatch(/ADD COLUMN "market_checked_at" TIMESTAMP\(3\)/);
    // Every ALTER TABLE statement is an ADD (column or constraint).
    for (const stmt of code.split(';').map((s) => s.trim()).filter((s) => /^ALTER TABLE/i.test(s))) {
      expect(stmt).toMatch(/^ALTER TABLE "\w+" ADD /);
    }
  });
});
