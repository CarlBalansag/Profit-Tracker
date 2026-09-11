import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { updateInventory, updateSale } = require('../validation/schemas');

describe('partial update schemas', () => {
  it('keeps omitted inventory values absent instead of applying create defaults', () => {
    expect(updateInventory.parse({ tracking_number: 'QA-123' })).toEqual({
      tracking_number: 'QA-123',
    });
  });

  it('keeps omitted sale values absent instead of applying create defaults', () => {
    expect(updateSale.parse({ status: 'PAID' })).toEqual({ status: 'PAID' });
  });

  it('still validates supplied update values', () => {
    expect(() => updateInventory.parse({ qty_purchased: 0 })).toThrow();
    expect(() => updateSale.parse({ commission_fee: -1 })).toThrow();
  });

  it('allows a payout date to be explicitly cleared', () => {
    expect(updateSale.parse({ payout_date: null })).toEqual({ payout_date: null });
  });
});
