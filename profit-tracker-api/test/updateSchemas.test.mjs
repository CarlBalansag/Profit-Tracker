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

  it('accepts a tracking number update on a sale', () => {
    expect(updateSale.parse({ tracking_number: '1Z999AA10123456784' })).toEqual({
      tracking_number: '1Z999AA10123456784',
    });
  });

  it('still validates supplied update values', () => {
    expect(() => updateInventory.parse({ qty_purchased: 0 })).toThrow();
    expect(() => updateSale.parse({ commission_fee: -1 })).toThrow();
  });

  it('allows a payout date to be explicitly cleared', () => {
    expect(updateSale.parse({ payout_date: null })).toEqual({ payout_date: null });
  });

  // ideas.md ISSUES #3: "Some sale rows still have PURCHASED as their status"
  // -- a Sale's status is a narrower post-sale-only subset; Inventory keeps
  // the full lifecycle union since it legitimately uses every value (e.g. a
  // purchase can be directly marked COMPLETED or CANCELLED with no sale).
  it('rejects an inventory-only status on a sale', () => {
    expect(() => updateSale.parse({ status: 'PURCHASED' })).toThrow();
    expect(() => updateSale.parse({ status: 'LISTED' })).toThrow();
  });

  it('accepts every real sale status, and every real inventory status including shared terminal ones', () => {
    for (const status of ['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED']) {
      expect(updateSale.parse({ status })).toEqual({ status });
    }
    for (const status of ['Pre Order', 'On Hand', 'PURCHASED', 'SHIPPED_IN', 'DELIVERED', 'SCANNED_IN', 'LISTED', 'COMPLETED', 'CANCELLED', 'RETURNED', 'DISPUTED']) {
      expect(updateInventory.parse({ status })).toEqual({ status });
    }
  });

  it('still rejects a garbage status on either side', () => {
    expect(() => updateSale.parse({ status: 'NOT_A_REAL_STATUS' })).toThrow();
    expect(() => updateInventory.parse({ status: 'NOT_A_REAL_STATUS' })).toThrow();
  });
});
