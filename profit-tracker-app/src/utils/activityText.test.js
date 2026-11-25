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

describe('describeActivity: setup records', () => {
  const link = (model, field, before, after) => ({ model, id: `${model}-${Math.random()}`, op: 'update', link: true, fields: { [field]: { before, after } } });
  const cardRow = (op) => ({ model: 'paymentMethod', id: 'c1', op, row: { values: { name: 'Amazon Store Card', type: 'Credit' }, dates: [] } });
  const setup = (record_type, detail) => ({ kind: 'change', record_type, detail });

  it('says what removing a card took it off', () => {
    const entry = setup('card', {
      action: 'delete', product_name: 'Amazon Store Card',
      rows: [cardRow('delete'), link('inventory', 'payment_method_id', 'c1', null), link('inventory', 'payment_method_id', 'c1', null),
        link('expense', 'payment_method_id', 'c1', null), link('sales', 'sale_shipping_payment_method_id', 'c1', null)],
    });
    expect(describeActivity(entry)).toEqual({
      title: 'Removed a card',
      change: 'Credit · Taken off 2 purchases, 1 expense, 1 shipping label',
      product: 'Amazon Store Card',
    });
  });

  it('says an undone removal put the card back on its records', () => {
    const entry = setup('card', {
      action: 'delete', undo: true, product_name: 'Amazon Store Card',
      rows: [cardRow('create'), link('inventory', 'payment_method_id', null, 'c1')],
    });
    expect(describeActivity(entry)).toMatchObject({ title: 'Undid: Removed a card', change: 'Credit · Put back on 1 purchase' });
  });

  it('names the fields an edit changed', () => {
    const entry = setup('card', {
      action: 'edit', product_name: 'Chase Freedom Flex',
      rows: [{ model: 'paymentMethod', id: 'c1', op: 'update', fields: { due_day: { before: 7, after: 9 }, credit_limit: { before: 3000, after: 5000 } } }],
    });
    expect(describeActivity(entry)).toEqual({ title: 'Edited card', change: 'Due day 7 → 9 · Limit $3,000.00 → $5,000.00', product: 'Chase Freedom Flex' });
  });

  it('shows what came and went with a platform, a recurring expense, and names goals', () => {
    const platform = setup('platform', {
      action: 'delete', product_name: 'Target',
      rows: [{ model: 'platform', id: 'p1', op: 'delete', row: { values: { type: 'Vendor' } } },
        { model: 'account', id: 'a1', op: 'delete', row: { values: {} } }, link('inventory', 'vendor_id', 'p1', null)],
    });
    expect(describeActivity(platform)).toMatchObject({ title: 'Removed a platform', change: 'Vendor · with 1 store account · Taken off 1 purchase' });

    const recurring = setup('recurring_expense', {
      action: 'create', product_name: 'Storage',
      rows: [{ model: 'recurringExpense', id: 'r1', op: 'create', row: { values: { amount: '50', frequency: 'monthly' } } },
        { model: 'expense', id: 'x1', op: 'create', row: { values: {} } }, { model: 'expense', id: 'x2', op: 'create', row: { values: {} } }],
    });
    expect(describeActivity(recurring)).toMatchObject({ title: 'Added a recurring expense', change: '$50.00 monthly · with 2 expenses' });

    expect(describeActivity(setup('goal', { action: 'create', product_name: 'totalRevenue', rows: [] })))
      .toMatchObject({ title: 'Added a goal', product: 'Revenue goal' });
    expect(describeActivity(setup('account', { action: 'edit', rows: [] }))).toMatchObject({ title: 'Edited store account', product: 'Store account' });
  });

  it('describes a removed cashout connection, and says its key is needed after undo', () => {
    const rows = [{ model: 'cashoutConnection', id: 'k1', op: 'delete', row: { values: {} } },
      { model: 'cashoutCommitment', id: 'm1', op: 'delete', row: { values: {} } }, { model: 'cashoutItemMatch', id: 'x1', op: 'delete', row: { values: {} } }];
    expect(describeActivity(setup('cashout_connection', { action: 'delete', product_name: 'My EB', rows })))
      .toEqual({ title: 'Removed a cashout connection', change: 'with 1 commitment · with 1 matched item', product: 'My EB' });
    const undone = setup('cashout_connection', { action: 'delete', undo: true, key_needed: true, product_name: 'My EB', rows: [{ ...rows[0], op: 'create' }] });
    expect(describeActivity(undone).change).toBe('Enter its key again to sync');
  });

  it('says which group was merged into which, what moved, and what an undo moved back', () => {
    const rows = [
      { model: 'platform', id: 'efb', op: 'update', fields: { notes: { before: null, after: 'x' } } },
      { model: 'platform', id: 'la', op: 'delete', row: { values: { name: 'LA Cashout', type: 'Cashout' } } },
      { model: 'sales', id: 's1', op: 'update', link: true, fields: { platform_id: { before: 'la', after: 'efb' } } },
      { model: 'sales', id: 's2', op: 'update', link: true, fields: { platform_id: { before: 'la', after: 'efb' } } },
      { model: 'importBatch', id: 'b1', op: 'update', link: true, fields: { platform_id: { before: 'la', after: 'efb' } } },
    ];
    const merged = { action: 'merge', product_name: 'LA Cashout', merged_into: 'EarnFromBuying', rows };
    expect(describeActivity(setup('platform', merged)))
      .toEqual({ title: 'Merged a cashout group', change: 'Into EarnFromBuying · Moved 2 sales, 1 import', product: 'LA Cashout' });
    expect(describeActivity(setup('platform', { ...merged, undo: true })))
      .toEqual({ title: 'Undid: Merged a cashout group', change: 'Out of EarnFromBuying · Moved back 2 sales, 1 import', product: 'LA Cashout' });
    expect(describeActivity(setup('platform', { ...merged, rows: rows.slice(1, 2) })).change).toBe('Into EarnFromBuying');
  });

  it('quotes a note, and names calendar events by date', () => {
    const note = setup('product_note', { action: 'create', product_name: 'Switch 2', rows: [{ model: 'productNote', id: 'n', op: 'create', row: { values: { note: 'Ask for price match' } } }] });
    expect(describeActivity(note)).toEqual({ title: 'Added a note', change: '“Ask for price match”', product: 'Switch 2' });
    const edit = setup('transaction_note', { action: 'edit', product_name: 'Switch 2', rows: [{ model: 'transactionNote', id: 'n', op: 'update', fields: { body: { before: 'a', after: 'Box dented' } } }] });
    expect(describeActivity(edit).change).toBe('Note “Box dented”');
    const event = setup('calendar_event', { action: 'create', product_name: 'Restock', rows: [{ model: 'calendarEvent', id: 'c', op: 'create', row: { values: { date: '2026-12-01' } } }] });
    expect(describeActivity(event)).toMatchObject({ title: 'Added a calendar event', change: 'Dec 1, 2026' });
  });
});

describe('describeActivity: log-only entries', () => {
  const event = (record_type, detail) => ({ kind: 'event', record_type, detail });
  it('names API key, setting, reset and cashout actions', () => {
    expect(describeActivity(event('api_key', { action: 'revoke', product_name: 'Claude' }))).toEqual({ title: 'Revoked an API key', change: '', product: 'Claude' });
    expect(describeActivity(event('api_key', { action: 'cashout_writes', allowed: true, product_name: 'Claude' })).title).toBe('Allowed cashout actions for an API key');
    expect(describeActivity(event('setting', { action: 'schedule_c', enabled: false, product_name: 'Schedule C' }))).toMatchObject({ title: 'Turned off Schedule C', product: 'Settings' });
    expect(describeActivity(event('data_reset', { action: 'everything', product_name: 'All data', deleted: { purchases: 12, sales: 1, expenses: 0 } })))
      .toEqual({ title: 'Reset all data', change: '12 purchases, 1 sale deleted', product: 'All data' });
    expect(describeActivity(event('cashout', { action: 'log_purchase', product_name: 'Switch 2', quantity: 2, cashout: 'My EB' })))
      .toEqual({ title: 'Logged a purchase with a cashout', change: 'Qty 2 · My EB', product: 'Switch 2' });
    expect(describeActivity(event('cashout_connection', { action: 'key_replaced', product_name: 'My EB' })).title).toBe('Replaced a cashout key');
  });
});
