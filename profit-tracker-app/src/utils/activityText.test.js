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

  it('describes an edit by the fields that changed, three at most', () => {
    const entry = {
      kind: 'change', record_type: 'sale',
      detail: {
        action: 'edit', product_name: 'Meta Quest 3S',
        rows: [
          { model: 'inventory', op: 'update', fields: { qty_on_hand: { before: 3, after: 2 } } },
          { model: 'sales', op: 'update', fields: {
            unit_price: { before: 150, after: 175 },
            quantity: { before: 2, after: 3 },
            sale_date: { before: '2026-10-01T12:00:00.000Z', after: '2026-10-03T12:00:00.000Z', date: true },
            platform_id: { before: 'a', after: 'b' },
            unit_price_decimal: { before: '150', after: '175' },
          } },
        ],
      },
    };
    expect(describeActivity(entry)).toEqual({
      title: 'Edited sale',
      change: 'Price $150.00 → $175.00 · Qty 2 → 3 · Date Oct 1, 2026 → Oct 3, 2026 · 1 more',
      product: 'Meta Quest 3S',
    });
  });

  it('describes adds, and undos of adds and edits', () => {
    const purchaseRow = { model: 'inventory', op: 'create', row: { values: { qty_purchased: 2, unit_purchase_cost: 99 } } };
    const saleRow = { model: 'sales', op: 'create', row: { values: { quantity: 1, unit_price: 150 } } };
    expect(describeActivity({ kind: 'change', record_type: 'purchase', detail: { action: 'create', product_name: 'Drill', rows: [purchaseRow, saleRow] } }))
      .toEqual({ title: 'Added a purchase', change: '2 × $99.00 · with 1 sale', product: 'Drill' });
    expect(describeActivity({ kind: 'change', record_type: 'sale', detail: { action: 'create', rows: [saleRow] } }))
      .toMatchObject({ title: 'Recorded a sale', change: '1 × $150.00' });
    expect(describeActivity({ kind: 'change', record_type: 'expense', detail: { action: 'create', undo: true, product_name: 'Tape', rows: [{ model: 'expense', op: 'delete', row: { values: { amount: 12 } } }] } }))
      .toEqual({ title: 'Undid: Added an expense', change: '$12.00', product: 'Tape' });
    expect(describeActivity({ kind: 'change', record_type: 'expense', detail: { action: 'edit', rows: [{ model: 'expense', op: 'update', fields: { amount_decimal: { before: '1', after: '2' } } }] } }))
      .toEqual({ title: 'Edited expense', change: '1 field updated', product: 'Expense' });
  });

  it('counts the purchases when one entry deletes several (undoing a cashout import), and its undo', () => {
    const inv = (op) => ({ model: 'inventory', op, row: { values: { qty_purchased: 1, unit_purchase_cost: 0 } } });
    const sale = (op) => ({ model: 'sales', op, row: { values: { quantity: 1, unit_price: 20 } } });
    const rows = (op) => [inv(op), inv(op), inv(op), sale(op), sale(op), sale(op)];
    expect(describeActivity({ kind: 'change', record_type: 'purchase', detail: { action: 'delete', product_name: 'ElectronicsBuyer import (3 purchases)', rows: rows('delete') } }))
      .toEqual({ title: 'Deleted 3 purchases', change: 'with 3 sales', product: 'ElectronicsBuyer import (3 purchases)' });
    expect(describeActivity({ kind: 'change', record_type: 'purchase', detail: { action: 'delete', undo: true, product_name: 'X', rows: rows('create') } }))
      .toMatchObject({ title: 'Undid: Deleted 3 purchases', change: 'with 3 sales' });
    // One purchase still reads as before.
    expect(describeActivity({ kind: 'change', record_type: 'purchase', detail: { action: 'delete', product_name: 'Drill', rows: [inv('delete'), sale('delete')] } }))
      .toMatchObject({ title: 'Deleted a purchase', change: '1 × $0.00 · with 1 sale' });
  });

  it('notes sales added in a detail-window save', () => {
    const entry = { kind: 'change', record_type: 'purchase', detail: { action: 'edit', rows: [
      { model: 'inventory', op: 'update', fields: { product_name: { before: 'Old', after: 'New' } } },
      { model: 'sales', op: 'create', row: { values: {} } },
    ] } };
    expect(describeActivity(entry).change).toBe('Name Old → New · 1 sale added');
  });

  it('falls back to a readable label for an action it does not know', () => {
    expect(actionLabel('mark_something_new')).toBe('Mark Something New');
  });
});
