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
beforeEach(() => {
  harness.reset();
  // The base fixture predates the status workflow; give it real workflow
  // states so the void actions are available, as they are on the website.
  Object.assign(harness.db.sales[0], { workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'AWAITING_SHIPMENT' });
  harness.db.inventory[0].receiving_status = 'PURCHASED';
});

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
const errorText = (res) => (res.rpcError ? res.rpcError.message : res.data);
const writeLogs = (tool) => harness.db.mcpWriteLog.filter((l) => l.tool === tool);

const OTHER_INV = '99999999-9999-4999-8999-0000000000c1';
const OTHER_SALE = '99999999-9999-4999-8999-0000000000c2';
const MISSING = '99999999-9999-4999-8999-0000000000ff';

describe('add_platform', () => {
  it('creates a platform, records a change row, and logs the write', async () => {
    const res = await callTool('add_platform', { name: '  StockX  ', type: 'Marketplace', fee_pct: 9.5 });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ id: expect.any(String), name: 'StockX', type: 'Marketplace', fee_pct: 9.5 });
    const row = harness.db.platform.find((p) => p.id === res.data.id);
    expect(row).toMatchObject({ user_id: ids.user, name: 'StockX', type: 'Marketplace', fee_pct: 9.5 });
    expect(harness.db.changeLog).toEqual([expect.objectContaining({
      user_id: ids.user, table_name: 'Platform', record_id: res.data.id, field: 'created',
      old_value: null, new_value: 'StockX (Marketplace)', source: 'mcp',
    })]);
    expect(writeLogs('add_platform')).toHaveLength(1);
  });

  it('defaults fee_pct to 0', async () => {
    const res = await callTool('add_platform', { name: 'Local Cashout', type: 'Cashout' });
    expect(res.data.fee_pct).toBe(0);
  });

  it('rejects a duplicate name case-insensitively, across types, naming the existing one', async () => {
    const before = harness.db.platform.length;
    const sameType = await callTool('add_platform', { name: 'qa marketplace', type: 'Marketplace' });
    expect(sameType.isError).toBe(true);
    expect(sameType.data).toMatch(/"QA Marketplace" \(Marketplace\) already exists/);
    const otherType = await callTool('add_platform', { name: 'QA STORE', type: 'Cashout' });
    expect(otherType.isError).toBe(true);
    expect(otherType.data).toMatch(/"QA Store" \(Vendor\) already exists/);
    expect(harness.db.platform).toHaveLength(before);
    expect(harness.db.changeLog).toHaveLength(0);
    expect(writeLogs('add_platform')).toHaveLength(0);
  });

  it('does not treat another user\'s platform name as a duplicate', async () => {
    const res = await callTool('add_platform', { name: 'Other user private platform', type: 'Marketplace' });
    expect(res.isError).toBe(false);
  });

  it('rejects bad input', async () => {
    const before = harness.db.platform.length;
    for (const args of [
      { name: '', type: 'Marketplace' },
      { name: '   ', type: 'Marketplace' },
      { name: 'x'.repeat(101), type: 'Marketplace' },
      { name: 'Fine', type: 'retail' },
      { name: 'Fine', type: 'Marketplace', fee_pct: -1 },
      { name: 'Fine', type: 'Marketplace', fee_pct: 101 },
      { name: 'Fine', type: 'Marketplace', extra: true },
      { type: 'Marketplace' },
    ]) {
      expect(rejected(await callTool('add_platform', args))).toBe(true);
    }
    expect(harness.db.platform).toHaveLength(before);
  });

  it('lets add_sale use the new platform by name', async () => {
    await callTool('add_platform', { name: 'GOAT', type: 'Marketplace', fee_pct: 9.5 });
    const sale = await callTool('add_sale', {
      inventory_id: ids.inventory, qty: 1, sale_price: 200, sale_date: '2026-10-01', platform: 'goat',
    });
    expect(sale.isError).toBe(false);
    const platform = harness.db.platform.find((p) => p.name === 'GOAT');
    expect(sale.data.platform_id).toBe(platform.id);
    // No workflow_preset is set, same as the website, so the default applies.
    expect(harness.db.sales.find((s) => s.id === sale.data.id).workflow_type).toBe('STANDARD_MARKETPLACE');
  });
});

describe('add_payment_method', () => {
  it('creates a card, records a change row, and logs the write', async () => {
    const res = await callTool('add_payment_method', { name: 'Amex Gold', type: 'Credit', last4: '1005', cashback_rate: 4 });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({ id: expect.any(String), name: 'Amex Gold', type: 'Credit', last4: '1005', cashback_rate: 4 });
    expect(harness.db.paymentMethod.find((m) => m.id === res.data.id))
      .toMatchObject({ user_id: ids.user, default_cashback_rate: 4, last4: '1005' });
    expect(harness.db.changeLog).toEqual([expect.objectContaining({
      table_name: 'PaymentMethod', record_id: res.data.id, field: 'created', new_value: 'Amex Gold (Credit)',
    })]);
    expect(writeLogs('add_payment_method')).toHaveLength(1);
  });

  it('defaults last4 to null and cashback_rate to 0', async () => {
    const res = await callTool('add_payment_method', { name: 'Checking', type: 'Debit' });
    expect(res.data).toMatchObject({ last4: null, cashback_rate: 0 });
  });

  it('rejects a duplicate name case-insensitively', async () => {
    const before = harness.db.paymentMethod.length;
    const res = await callTool('add_payment_method', { name: 'qa credit CARD', type: 'Debit' });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/"QA Credit Card" \(Credit\) already exists/);
    expect(harness.db.paymentMethod).toHaveLength(before);
    expect(writeLogs('add_payment_method')).toHaveLength(0);
  });

  it('rejects bad input', async () => {
    const before = harness.db.paymentMethod.length;
    for (const args of [
      { name: '', type: 'Credit' },
      { name: 'Card', type: 'Prepaid' },
      { name: 'Card', type: 'Credit', last4: '123' },
      { name: 'Card', type: 'Credit', last4: '12a4' },
      { name: 'Card', type: 'Credit', last4: '12345' },
      { name: 'Card', type: 'Credit', cashback_rate: -0.5 },
      { name: 'Card', type: 'Credit', cashback_rate: 150 },
    ]) {
      expect(rejected(await callTool('add_payment_method', args))).toBe(true);
    }
    expect(harness.db.paymentMethod).toHaveLength(before);
  });

  it('lets add_purchase use the new card by name', async () => {
    await callTool('add_payment_method', { name: 'Chase Freedom', type: 'Credit', last4: '4321' });
    const res = await callTool('add_purchase', {
      item: 'New Console', qty: 1, unit_cost: 400, store: 'QA Store', card_used: 'chase freedom', purchase_date: '2026-10-02',
    });
    expect(res.isError).toBe(false);
    expect(res.data.card_used).toBe('Chase Freedom');
  });
});

describe('void_sale', () => {
  it('rejects a call without confirm, or with confirm false, and changes nothing', async () => {
    for (const confirm of [undefined, false, 'true', 1]) {
      const args = { sale_id: ids.sale, reason: 'duplicate entry', ...(confirm === undefined ? {} : { confirm }) };
      expect(rejected(await callTool('void_sale', args))).toBe(true);
    }
    expect(harness.db.sales[0].workflow_status).toBe('AWAITING_SHIPMENT');
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    expect(harness.db.changeLog).toHaveLength(0);
  });

  it('rejects a missing or blank reason', async () => {
    expect(rejected(await callTool('void_sale', { sale_id: ids.sale, confirm: true }))).toBe(true);
    expect(rejected(await callTool('void_sale', { sale_id: ids.sale, reason: '  ', confirm: true }))).toBe(true);
    expect(rejected(await callTool('void_sale', { sale_id: ids.sale, reason: 'x'.repeat(501), confirm: true }))).toBe(true);
  });

  it('voids the sale, restores qty_on_hand, stores the reason, and records the changes', async () => {
    const res = await callTool('void_sale', { sale_id: ids.sale, reason: 'Entered twice', confirm: true });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({
      id: ids.sale, status: 'CANCELLED', voided_at: expect.any(String), void_reason: 'Entered twice', qty_restored: 2,
    });
    const sale = harness.db.sales[0];
    expect(sale).toMatchObject({ workflow_status: 'CANCELLED', status: 'CANCELLED', void_reason: 'Entered twice' });
    expect(sale.voided_at).toBeInstanceOf(Date);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
    // Nothing is deleted.
    expect(harness.db.sales).toHaveLength(1);

    const byField = Object.fromEntries(harness.db.changeLog.map((c) => [c.field, c]));
    expect(byField.voided).toMatchObject({ table_name: 'Sales', record_id: ids.sale, new_value: res.data.voided_at });
    expect(byField.void_reason).toMatchObject({ old_value: null, new_value: 'Entered twice' });
    expect(byField.workflow_status).toMatchObject({ old_value: 'AWAITING_SHIPMENT', new_value: 'CANCELLED' });
    expect(writeLogs('void_sale')).toHaveLength(1);
  });

  it('rejects voiding the same sale twice without restoring stock again', async () => {
    await callTool('void_sale', { sale_id: ids.sale, reason: 'first', confirm: true });
    const again = await callTool('void_sale', { sale_id: ids.sale, reason: 'second', confirm: true });
    expect(again.isError).toBe(true);
    expect(again.data).toMatch(/already voided/);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
    expect(harness.db.sales[0].void_reason).toBe('first');
    expect(writeLogs('void_sale')).toHaveLength(1);
  });

  it('restores stock only once when two voids race', async () => {
    const [a, b] = await Promise.all([
      callTool('void_sale', { sale_id: ids.sale, reason: 'a', confirm: true }),
      callTool('void_sale', { sale_id: ids.sale, reason: 'b', confirm: true }),
    ]);
    expect([a.isError, b.isError].sort()).toEqual([false, true]);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });

  it('rejects another user\'s sale and a missing sale', async () => {
    harness.db.inventory.push({ id: OTHER_INV, user_id: ids.other, product_name: 'Private', qty_purchased: 1, qty_on_hand: 0, unit_purchase_cost: 10, receiving_status: 'PURCHASED' });
    harness.db.sales.push({ id: OTHER_SALE, inventory_id: OTHER_INV, platform_id: ids.foreign, quantity: 1, unit_price: 20, status: 'SOLD', workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'AWAITING_SHIPMENT', sale_date: new Date() });
    for (const sale_id of [OTHER_SALE, MISSING]) {
      const res = await callTool('void_sale', { sale_id, reason: 'nope', confirm: true });
      expect(res.isError).toBe(true);
      expect(res.data).toMatch(/not found or access denied/);
    }
    expect(harness.db.sales.find((s) => s.id === OTHER_SALE).workflow_status).toBe('AWAITING_SHIPMENT');
    expect(harness.db.inventory.find((i) => i.id === OTHER_INV).qty_on_hand).toBe(0);
  });

  it('gives a clear error for a sale whose status does not allow a void', async () => {
    harness.db.sales[0].workflow_status = 'RETURNED';
    const res = await callTool('void_sale', { sale_id: ids.sale, reason: 'x', confirm: true });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/cannot be voided from its current status \(RETURNED\)/);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });
});

describe('void_purchase', () => {
  it('requires confirm true', async () => {
    for (const confirm of [undefined, false]) {
      const args = { purchase_id: ids.inventory, reason: 'mistake', ...(confirm === undefined ? {} : { confirm }) };
      expect(rejected(await callTool('void_purchase', args))).toBe(true);
    }
    expect(harness.db.inventory[0].cancelled_at).toBeUndefined();
  });

  it('is blocked while the purchase has a live sale, listing the sale ids, and changes nothing', async () => {
    const res = await callTool('void_purchase', { purchase_id: ids.inventory, reason: 'mistake', confirm: true });
    expect(res.isError).toBe(true);
    expect(res.data).toContain(ids.sale);
    expect(harness.db.inventory[0].cancelled_at).toBeUndefined();
    expect(harness.db.inventory[0].void_reason).toBeUndefined();
    expect(harness.db.changeLog).toHaveLength(0);
    expect(writeLogs('void_purchase')).toHaveLength(0);
  });

  it('works once the sale is voided, and records the changes', async () => {
    await callTool('void_sale', { sale_id: ids.sale, reason: 'wrong item', confirm: true });
    const res = await callTool('void_purchase', { purchase_id: ids.inventory, reason: 'Never ordered', confirm: true });
    expect(res.isError).toBe(false);
    expect(res.data).toEqual({
      id: ids.inventory, item: 'QA Multi-unit Sneaker', cancelled_at: expect.any(String), void_reason: 'Never ordered',
    });
    const inv = harness.db.inventory[0];
    expect(inv.cancelled_at).toBeInstanceOf(Date);
    expect(inv).toMatchObject({ void_reason: 'Never ordered', receiving_status: 'PURCHASED', qty_on_hand: 5 });
    expect(harness.db.inventory).toHaveLength(1);
    expect(harness.db.sales).toHaveLength(1);

    const rows = harness.db.changeLog.filter((c) => c.table_name === 'Inventory');
    expect(rows.map((c) => c.field).sort()).toEqual(['void_reason', 'voided']);
    expect(rows.find((c) => c.field === 'voided').new_value).toBe(res.data.cancelled_at);
    expect(writeLogs('void_purchase')).toHaveLength(1);
  });

  it('works for a purchase with no sales, and rejects a second void', async () => {
    harness.db.sales = [];
    const first = await callTool('void_purchase', { purchase_id: ids.inventory, reason: 'dup', confirm: true });
    expect(first.isError).toBe(false);
    const second = await callTool('void_purchase', { purchase_id: ids.inventory, reason: 'dup again', confirm: true });
    expect(second.isError).toBe(true);
    expect(second.data).toMatch(/already cancelled/);
    expect(harness.db.inventory[0].void_reason).toBe('dup');
  });

  it('treats a legacy-cancelled sale as closed', async () => {
    Object.assign(harness.db.sales[0], { status: 'CANCELLED', workflow_status: 'CANCELLED' });
    const res = await callTool('void_purchase', { purchase_id: ids.inventory, reason: 'x', confirm: true });
    expect(res.isError).toBe(false);
  });

  it('rejects a purchase that has already been received', async () => {
    harness.db.sales = [];
    harness.db.inventory[0].receiving_status = 'ON_HAND';
    const res = await callTool('void_purchase', { purchase_id: ids.inventory, reason: 'x', confirm: true });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/ON_HAND/);
    expect(harness.db.inventory[0].cancelled_at).toBeUndefined();
  });

  it('rejects another user\'s purchase and a missing purchase', async () => {
    harness.db.inventory.push({ id: OTHER_INV, user_id: ids.other, product_name: 'Private', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 10, receiving_status: 'PURCHASED' });
    for (const purchase_id of [OTHER_INV, MISSING]) {
      const res = await callTool('void_purchase', { purchase_id, reason: 'x', confirm: true });
      expect(res.isError).toBe(true);
      expect(res.data).toMatch(/not found or access denied/);
    }
    expect(harness.db.inventory.find((i) => i.id === OTHER_INV).cancelled_at).toBeUndefined();
  });
});

describe('list_changes', () => {
  it('shows the void rows for a sale and a purchase', async () => {
    await callTool('void_sale', { sale_id: ids.sale, reason: 'oops', confirm: true });
    await callTool('void_purchase', { purchase_id: ids.inventory, reason: 'oops too', confirm: true });

    const sale = await callTool('list_changes', { record_id: ids.sale });
    expect(sale.data.map((c) => c.field).sort()).toEqual(['void_reason', 'voided', 'workflow_status']);
    expect(sale.data.every((c) => c.table === 'Sales' && c.source === 'mcp')).toBe(true);

    const purchase = await callTool('list_changes', { record_id: ids.inventory });
    expect(purchase.data.map((c) => c.field).sort()).toEqual(['void_reason', 'voided']);
    expect(purchase.data.find((c) => c.field === 'void_reason').new_value).toBe('oops too');
  });

  it('shows platform and card creations', async () => {
    await callTool('add_platform', { name: 'Mercari', type: 'Marketplace' });
    await callTool('add_payment_method', { name: 'Discover', type: 'Credit' });
    const { data } = await callTool('list_changes', {});
    expect(data.map((c) => `${c.table}:${c.new_value}`).sort())
      .toEqual(['PaymentMethod:Discover (Credit)', 'Platform:Mercari (Marketplace)']);
  });
});

describe('add_void_reason migration SQL', () => {
  it('only adds nullable void_reason columns and never drops anything', async () => {
    const sql = await readFile(new URL('../prisma/migrations/20261031010000_add_void_reason/migration.sql', import.meta.url), 'utf8');
    const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements).toEqual([
      'ALTER TABLE "Sales" ADD COLUMN "void_reason" TEXT',
      'ALTER TABLE "Inventory" ADD COLUMN "void_reason" TEXT',
    ]);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/NOT NULL/i);
  });
});
