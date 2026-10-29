// Read-only expense lines computed from purchases and sales, so the Expenses
// tab can show every cost in one place without a second copy of the money.
// Nothing is stored: each line is rebuilt from the Inventory/Sales row on every
// read, so edits, status changes, and deletes are reflected automatically and
// the amounts always match what Dashboard/Analytics already count.
//
// These lines are deliberately NOT returned by GET /api/expenses (and so never
// reach Schedule C Part II or MCP list_expenses): purchase tax, inbound
// shipping and fees are already part of batchCost(), and sale shipping and
// commission are already subtracted from sale revenue.
const { decimal, isRealizedSale } = require('./decimalFinance');
const { withExactFields, MAPPINGS } = require('./decimalRead');

// A gift card reduces what the purchase cost (batchCost subtracts it), so it
// is listed as a negative credit line.
const PURCHASE_LINES = [
  { field: 'sales_tax',             category: 'PURCHASE_TAX',     label: 'Sales tax',        key: 'tax' },
  { field: 'shipping_cost_inbound', category: 'INBOUND_SHIPPING', label: 'Inbound shipping', key: 'shipping' },
  { field: 'fees',                  category: 'PURCHASE_FEE',     label: 'Purchase fee',     key: 'fees' },
  { field: 'gift_card_amount',      category: 'GIFT_CARD_CREDIT', label: 'Gift card',        key: 'gift_card', credit: true },
];
const SALE_LINES = [
  { field: 'sale_shipping',  category: 'SHIPPING_LABEL',    label: 'Shipping label', key: 'shipping' },
  { field: 'commission_fee', category: 'SALE_PLATFORM_FEE', label: 'Platform fee',   key: 'commission' },
];

const money = (value) => decimal(value || 0).toDecimalPlaces(2).toNumber();

function derivedExpenseLines(inventories = []) {
  const lines = [];
  for (const raw of inventories) {
    const inv = withExactFields(raw, MAPPINGS.inventory);
    const product = inv.product_name || 'Untitled item';
    const paymentMethod = inv.payment_method
      ? { id: inv.payment_method.id, name: inv.payment_method.name, type: inv.payment_method.type }
      : null;
    for (const line of PURCHASE_LINES) {
      const value = money(inv[line.field]);
      if (value <= 0) continue;
      const amount = line.credit ? -value : value;
      lines.push({
        id: `purchase:${inv.id}:${line.key}`,
        source: 'purchase',
        readonly: true,
        inventory_id: inv.id,
        sale_id: null,
        product_name: product,
        cost_type: line.label,
        name: `${product} · ${line.label}`,
        category: line.category,
        amount,
        date: inv.purchase_date,
        payment_method_id: inv.payment_method_id || null,
        payment_method: paymentMethod,
      });
    }
    // Cancelled, returned, and disputed sales are excluded, matching the
    // realized-sale rule every revenue/profit total uses.
    for (const rawSale of (inv.sales || []).filter(isRealizedSale)) {
      const sale = withExactFields(rawSale, MAPPINGS.sales);
      for (const line of SALE_LINES) {
        const amount = money(sale[line.field]);
        if (amount <= 0) continue;
        lines.push({
          id: `sale:${sale.id}:${line.key}`,
          source: 'sale',
          readonly: true,
          inventory_id: inv.id,
          sale_id: sale.id,
          product_name: product,
          cost_type: line.label,
          name: `${product} · ${line.label}`,
          category: line.category,
          amount,
          date: sale.sale_date,
          payment_method_id: null,
          payment_method: null,
        });
      }
    }
  }
  return lines.sort((a, b) => new Date(b.date) - new Date(a.date) || a.id.localeCompare(b.id));
}

module.exports = { derivedExpenseLines, PURCHASE_LINES, SALE_LINES };
