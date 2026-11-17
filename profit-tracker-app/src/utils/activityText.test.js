import { describe, expect, it } from 'vitest';
import { describeActivity, actionLabel } from './activityText';

const status = (detail, over = {}) => ({ kind: 'status', record_type: 'sale', detail: { product_name: 'Meta Quest 3S', ...detail }, ...over });

describe('describeActivity', () => {
  it('describes a status change with its button label, the move, and any stock it moved', () => {
    expect(describeActivity(status({ action: 'cancel_sale', from: 'PAID', to: 'CANCELLED', stock: { delta: 2 } })))
      .toEqual({ title: 'Cancel Sale', change: 'Paid → Cancelled · 2 units back in stock', product: 'Meta Quest 3S' });
  });

  it('marks an undo as such', () => {
    expect(describeActivity(status({ action: 'cancel_sale', undo: true, from: 'CANCELLED', to: 'PAID', stock: { delta: -1 } })))
      .toMatchObject({ title: 'Undid: Cancel Sale', change: 'Cancelled → Paid · 1 unit out of stock again' });
  });

  it('shows a quantity adjustment as on-hand before and after', () => {
    const entry = status({ action: 'restore_inventory', from: 'ON_HAND', to: 'ON_HAND', fields: { qty_on_hand: { before: 3, after: 5 } } }, { record_type: 'purchase' });
    expect(describeActivity(entry)).toMatchObject({ title: 'Adjust Quantity On Hand', change: 'On hand 3 → 5' });
  });

  it('names refunds by side and direction', () => {
    const refund = { amount: '40.00', quantity: 1 };
    expect(describeActivity({ kind: 'refund.add', record_type: 'purchase', detail: { refund, product_name: 'Drill' } }))
      .toEqual({ title: 'Refund from the store', change: '$40.00 · 1 unit sent back', product: 'Drill' });
    expect(describeActivity({ kind: 'refund.add', record_type: 'sale', detail: { refund: { amount: '25', quantity: 0 } } }))
      .toEqual({ title: 'Refund to the buyer', change: '$25.00', product: 'Sale' });
    expect(describeActivity({ kind: 'refund.remove', record_type: 'sale', reverts_id: 'x', detail: { refund: { amount: '25', quantity: 2 } } }))
      .toMatchObject({ title: 'Undid a refund', change: '$25.00 · 2 units returned by buyer' });
    expect(describeActivity({ kind: 'refund.add', record_type: 'purchase', reverts_id: 'x', detail: { refund } }).title).toBe('Brought back a refund');
    expect(describeActivity({ kind: 'refund.remove', record_type: 'purchase', detail: { refund } }).title).toBe('Removed a refund');
  });

  it('falls back to a readable label for an action it does not know', () => {
    expect(actionLabel('mark_something_new')).toBe('Mark Something New');
  });
});
