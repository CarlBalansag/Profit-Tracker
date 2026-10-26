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
  if (payload.error) return { rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { isError: result.isError || false, data };
}

describe('tracking/order fields on add_purchase and update_purchase', () => {
  it('stores tracking_number, carrier, and order_number on a new purchase', async () => {
    const { data } = await callTool('add_purchase', {
      item: 'QA Widget', qty: 1, unit_cost: 10, store: 'QA Store', card_used: 'QA Credit Card',
      purchase_date: '2026-10-01', order_number: 'ORD-1', tracking_number: '1Z999AA10123456784', carrier: 'UPS',
    });
    expect(data.order_number).toBe('ORD-1');
    expect(data.tracking_number).toBe('1Z999AA10123456784');
    expect(data.carrier).toBe('UPS');
  });

  it('auto-detects carrier from the tracking number when carrier is not given', async () => {
    const { data } = await callTool('add_purchase', {
      item: 'QA Widget', qty: 1, unit_cost: 10, store: 'QA Store', card_used: 'QA Credit Card',
      purchase_date: '2026-10-01', tracking_number: '1Z999AA10123456784',
    });
    expect(data.carrier).toBe('UPS');
  });

  it('update_purchase edits order_number/tracking_number/carrier/tax_exempt and logs each change', async () => {
    const { data } = await callTool('update_purchase', {
      purchase_id: harness.ids.inventory, order_number: 'ORD-2', carrier: 'FedEx', tax_exempt: true,
    });
    expect(data.order_number).toBe('ORD-2');
    expect(data.carrier).toBe('FedEx');
    expect(data.tax_exempt).toBe(true);

    const { data: changes } = await callTool('list_changes', { record_id: harness.ids.inventory });
    const fields = changes.map((c) => c.field).sort();
    expect(fields).toEqual(['carrier', 'order_number', 'tax_exempt']);
  });

  it('adding a tracking number for the first time auto-advances receiving status', async () => {
    harness.db.inventory[0].tracking_number = null;
    harness.db.inventory[0].receiving_status = 'PURCHASED';
    const { data } = await callTool('update_purchase', { purchase_id: harness.ids.inventory, tracking_number: '1Z999AA10123456784' });
    expect(data.status).toBe('INBOUND');
    expect(data.tracking_number).toBe('1Z999AA10123456784');
  });

  it('rejects adding a tracking number to a purchase that already arrived', async () => {
    harness.db.inventory[0].tracking_number = null;
    harness.db.inventory[0].receiving_status = 'ON_HAND';
    const { isError, data } = await callTool('update_purchase', { purchase_id: harness.ids.inventory, tracking_number: '1Z999AA10123456784' });
    expect(isError).toBe(true);
    expect(data).toContain('already been received');
  });
});

describe('tracking fields on add_sale and update_sale', () => {
  it('add_sale stores outbound tracking_number and carrier', async () => {
    const { data } = await callTool('add_sale', {
      inventory_id: harness.ids.inventory, qty: 1, sale_price: 50, sale_date: '2026-10-01',
      platform: 'QA Marketplace', tracking_number: '1Z999AA10123456784', carrier: 'UPS',
    });
    expect(data.tracking_number).toBe('1Z999AA10123456784');
    expect(data.carrier).toBe('UPS');
  });

  it('update_sale sets tracking/carrier and auto-advances workflow status on first tracking number', async () => {
    harness.db.sales[0].workflow_status = 'AWAITING_SHIPMENT';
    const { data } = await callTool('update_sale', { sale_id: harness.ids.sale, tracking_number: '1Z999AA10123456784' });
    expect(data.tracking_number).toBe('1Z999AA10123456784');
    expect(data.carrier).toBe('UPS');
    expect(data.status).toBe('OUTBOUND');
  });

  it('rejects adding outbound tracking to a sale that is not awaiting shipment', async () => {
    harness.db.sales[0].workflow_status = 'PAID';
    const { isError, data } = await callTool('update_sale', { sale_id: harness.ids.sale, tracking_number: '1Z999AA10123456784' });
    expect(isError).toBe(true);
    expect(data).toContain('not awaiting shipment');
  });
});

describe('list_inventory / list_sales return the new fields', () => {
  it('list_inventory includes order_number, tracking_number, carrier, tax_exempt', async () => {
    const { data } = await callTool('list_inventory', {});
    const row = data.find((r) => r.id === harness.ids.inventory);
    expect(row.tracking_number).toBe('9400111899223856928499');
    expect(row.carrier).toBe('USPS'); // auto-detected, no stored carrier on the fixture row
    expect(row.tax_exempt).toBe(false);
  });

  it('list_sales includes tracking_number and carrier', async () => {
    harness.db.sales[0].tracking_number = '1Z999AA10123456784';
    const { data } = await callTool('list_sales', {});
    const row = data.find((r) => r.id === harness.ids.sale);
    expect(row.tracking_number).toBe('1Z999AA10123456784');
    expect(row.carrier).toBe('UPS');
  });
});

describe('list_shipments', () => {
  beforeEach(() => {
    harness.db.inventory[0].receiving_status = 'INBOUND';
    harness.db.inventory[0].receiving_status_changed_at = new Date('2026-10-05T00:00:00Z');
    harness.db.sales[0].workflow_status = 'AWAITING_SHIPMENT';
    harness.db.sales[0].workflow_status_changed_at = new Date('2026-10-06T00:00:00Z');
  });

  it('lists both an inbound purchase and an outbound sale by default', async () => {
    const { data } = await callTool('list_shipments', {});
    const directions = data.map((r) => r.direction).sort();
    expect(directions).toEqual(['inbound', 'outbound']);
    const inbound = data.find((r) => r.direction === 'inbound');
    expect(inbound.id).toBe(harness.ids.inventory);
    expect(inbound.status).toBe('INBOUND');
    expect(inbound.last_updated).toBe('2026-10-05');
  });

  it('filters by direction', async () => {
    const { data } = await callTool('list_shipments', { direction: 'outbound' });
    expect(data).toHaveLength(1);
    expect(data[0].direction).toBe('outbound');
  });

  it('filters by missing_tracking', async () => {
    harness.db.sales[0].tracking_number = null;
    const { data } = await callTool('list_shipments', { missing_tracking: true });
    // Inventory fixture row already has a tracking number, so only the sale qualifies.
    expect(data).toHaveLength(1);
    expect(data[0].direction).toBe('outbound');
  });

  it('a received purchase (qty_on_hand = 0 or ON_HAND) drops off the list', async () => {
    harness.db.inventory[0].qty_on_hand = 0;
    const { data } = await callTool('list_shipments', { direction: 'inbound' });
    expect(data).toHaveLength(0);
  });
});

describe('update_shipment', () => {
  it('sets tracking/carrier/status on an inbound purchase and logs each change', async () => {
    harness.db.inventory[0].receiving_status = 'ON_HAND';
    const { data } = await callTool('update_shipment', {
      item_id: harness.ids.inventory, carrier: 'FedEx', status: 'inbound',
    });
    expect(data.direction).toBe('inbound');
    expect(data.carrier).toBe('FedEx');
    expect(data.status).toBe('INBOUND');

    const { data: changes } = await callTool('list_changes', { record_id: harness.ids.inventory });
    const fields = changes.map((c) => c.field).sort();
    expect(fields).toEqual(['carrier', 'receiving_status']);
  });

  it('rejects an invalid receiving status', async () => {
    const { isError, data } = await callTool('update_shipment', { item_id: harness.ids.inventory, status: 'NOT_A_STATUS' });
    expect(isError).toBe(true);
    expect(data).toContain('Invalid receiving status');
  });

  it('sets tracking/carrier/status on an outbound sale, dual-writing the legacy status for an exception status', async () => {
    harness.db.sales[0].workflow_status = 'OUTBOUND';
    const { data } = await callTool('update_shipment', { item_id: harness.ids.sale, status: 'cancelled' });
    expect(data.direction).toBe('outbound');
    expect(data.status).toBe('CANCELLED');
    expect(harness.db.sales[0].status).toBe('CANCELLED');
  });

  it('rejects a workflow status that does not belong to the sale\'s workflow', async () => {
    const { isError, data } = await callTool('update_shipment', { item_id: harness.ids.sale, status: 'NOT_A_STATUS' });
    expect(isError).toBe(true);
    expect(data).toContain('Invalid status for this sale');
  });

  it('errors on an id that is neither an owned purchase nor an owned sale', async () => {
    const { isError, data } = await callTool('update_shipment', { item_id: '99999999-9999-4999-8999-999999999999', tracking_number: 'X' });
    expect(isError).toBe(true);
    expect(data).toContain('not found');
  });

  it('is a no-op (not an error) when no fields are given', async () => {
    const { isError, data } = await callTool('update_shipment', { item_id: harness.ids.inventory });
    expect(isError).toBe(false);
    expect(data.id).toBe(harness.ids.inventory);
  });
});

describe('get_card_net_to_pay', () => {
  it('returns one small row per card, matching the Credit Card page\'s own numbers', async () => {
    harness.db.paymentMethod[0].last4 = '1234';

    const { data } = await callTool('get_card_net_to_pay', { month: '2026-09' });
    expect(data).toHaveLength(1);
    const row = data[0];
    expect(row.card).toBe('QA Credit Card');
    expect(row.last4).toBe('1234');
    expect(typeof row.net_to_pay).toBe('number');
    expect(Object.keys(row).sort()).toEqual(['card', 'due_date', 'last4', 'net_to_pay']);

    const dashboardRes = await fetch(`${baseUrl}/api/creditcard/dashboard?month=2026-09`, {
      headers: { Accept: 'application/json' },
    });
    const dashboard = await dashboardRes.json();
    const dashboardCard = dashboard.cards.find((c) => c.id === harness.ids.card);
    expect(row.net_to_pay).toBe(dashboardCard.amountToPay);
    expect(row.last4).toBe(dashboardCard.last4);
  });

  it('defaults to the current month when none is given', async () => {
    const { isError } = await callTool('get_card_net_to_pay', {});
    expect(isError).toBe(false);
  });

  it('rejects a malformed month', async () => {
    const { isError, data } = await callTool('get_card_net_to_pay', { month: '2026/09' });
    expect(isError || data === undefined).toBeTruthy();
  });
});
