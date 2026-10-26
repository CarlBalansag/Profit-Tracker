import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createExpense,
  createInventory,
  createSale,
  attachReceipt,
  recurringExpense,
} = require('../validation/schemas');

describe('API validation schemas', () => {
  it('coerces valid inventory payloads and rejects invalid quantities', () => {
    const parsed = createInventory.parse({
      product_name: 'Console bundle',
      unit_purchase_cost: '199.99',
      qty_purchased: '2',
      sales_tax: '',
      purchase_date: '2026-05-23',
    });

    expect(parsed.unit_purchase_cost).toBe(199.99);
    expect(parsed.qty_purchased).toBe(2);
    expect(parsed.sales_tax).toBe(0);

    expect(() => createInventory.parse({
      product_name: 'Console bundle',
      qty_purchased: '0',
    })).toThrow();
  });

  it('applies decimalAmount defaults when the key is entirely absent, not just empty', () => {
    // Regression test: decimalAmount's defaultValue previously only applied
    // when the field was present-but-empty (e.g. sales_tax: ''); a fully
    // absent key was intercepted by Zod's .optional() before the default
    // logic ever ran, silently leaving it undefined. Fixed by using a real
    // Zod .default() wrapper instead.
    const parsed = createInventory.parse({
      product_name: 'No fees field at all',
      unit_purchase_cost: '10.00',
      qty_purchased: '1',
      // fees, gift_card_amount, shipping_cost_inbound keys entirely omitted
    });
    expect(parsed.fees).toBe(0);
    expect(parsed.gift_card_amount).toBe(0);
    expect(parsed.shipping_cost_inbound).toBe(0);
  });

  it('requires valid money and dates for expenses', () => {
    expect(createExpense.parse({
      name: 'Software',
      amount: '12.50',
      date: '2026-05-23',
    }).amount).toBe(12.5);

    expect(() => createExpense.parse({
      name: 'Software',
      amount: 'abc',
      date: 'not-a-date',
    })).toThrow();
  });

  it('requires sale inventory id and unit price', () => {
    expect(() => createSale.parse({
      inventory_id: 'not-a-uuid',
      unit_price: '30',
    })).toThrow();

    expect(createSale.parse({
      inventory_id: '11111111-1111-4111-8111-111111111111',
      unit_price: '30',
      quantity: '1',
    }).unit_price).toBe(30);

    expect(createSale.parse({
      inventory_id: '11111111-1111-4111-8111-111111111111',
      unit_price: '30',
      quantity: '1',
      tracking_number: '1Z999AA10123456784',
    }).tracking_number).toBe('1Z999AA10123456784');
  });

  it('limits recurring frequency values', () => {
    expect(() => recurringExpense.parse({
      name: 'Rent',
      amount: 1000,
      frequency: 'daily',
      start_date: '2026-05-01',
    })).toThrow();
  });

  it('requires receipt ownership target and file data shape', () => {
    expect(() => attachReceipt.parse({
      itemType: 'invoice',
      itemId: '11111111-1111-4111-8111-111111111111',
      fileData: 'data:image/png;base64,abc',
    })).toThrow();
  });

  // ideas.md ISSUES #3: a create request must reject an inventory-only
  // status on a sale too, not just updates.
  it('rejects an inventory-only status on createSale', () => {
    expect(() => createSale.parse({
      inventory_id: '11111111-1111-4111-8111-111111111111',
      unit_price: 10,
      status: 'PURCHASED',
    })).toThrow();
  });
});
