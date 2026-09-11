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
});
