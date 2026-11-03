import { describe, expect, it } from 'vitest';
import { fieldsForAction, quickStatusOptions } from './statusActions';
import { correctableSaleStatuses } from './statusWorkflow';

// The server refuses reopening a sale whose units a cancel/void/return already
// put back (statusTransitions.reopensRestoredSale), so neither status picker
// offers a status that would be refused.
describe('sale status options after units were restored', () => {
  const restored = { workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'CANCELLED', restored_qty: 2 };
  const statusField = (record) => fieldsForAction('correct_status', 'sale', record)[0];

  it('offers only Cancelled, Returned and Disputed', () => {
    expect(quickStatusOptions('sale', restored)).toEqual(['CANCELLED', 'RETURNED', 'DISPUTED']);
    expect(statusField(restored).options).toEqual(['CANCELLED', 'RETURNED', 'DISPUTED']);
  });

  it('keeps the full list when nothing was restored', () => {
    const full = correctableSaleStatuses('STANDARD_MARKETPLACE');
    expect(quickStatusOptions('sale', { ...restored, restored_qty: 0 })).toEqual(full);
    expect(statusField({ workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'PAID' }).options).toEqual(full);
  });
});
