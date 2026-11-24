// What "Review & link" will do, before it does it: the record(s) the order
// would be linked to, field by field, with the blanks linking fills in marked
// (purchaseFills / saleFills, the same rules the link itself uses), plus what
// else happens right away. Read-only.
const { normOrder, purchaseFills, saleFills, CASHOUTS } = require('./match');
const { SENDERS } = require('./config');

const FIELD_LABELS = { order_number: 'Order #', tracking_number: 'Tracking #', carrier: 'Carrier' };
const storeLabel = (merchant) => SENDERS.find((s) => s.key === merchant)?.label || String(merchant || '').replace(/^custom:/, '');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (n) => (n == null || Number.isNaN(Number(n)) ? null : Number(n).toFixed(2));
const cardName = (pm) => (pm ? `${pm.name}${pm.last4 ? ` ••${pm.last4}` : ''}` : null);

async function loadRecords(prisma, userId, recordType, ids) {
  if (recordType === 'purchase') {
    return prisma.inventory.findMany({ where: { id: { in: ids }, user_id: userId }, include: { vendor: { select: { name: true } }, payment_method: { select: { name: true, last4: true } } } });
  }
  if (recordType === 'sale') {
    return prisma.sales.findMany({ where: { id: { in: ids }, inventory: { user_id: userId } }, include: { inventory: { select: { product_name: true } }, platform: { select: { name: true } } } });
  }
  return prisma.expense.findMany({ where: { id: { in: ids }, user_id: userId }, include: { payment_method: { select: { name: true, last4: true } } } });
}

function fillsFor(recordType, row, order) {
  if (recordType === 'purchase') return purchaseFills(row, order);
  if (recordType === 'sale') return saleFills(row, order);
  return {};
}

function recordView(recordType, row, order) {
  const fills = fillsFor(recordType, row, order);
  const f = (key, label, value) => ({ key, label, value: value ?? null, ...(fills[key] !== undefined ? { fill: String(fills[key]) } : {}) });
  // The record already has a different order number than the email: likely another order.
  const [emailNo, rowNo] = [normOrder(order.order_number), normOrder(row.order_number)];
  const conflict = recordType === 'purchase' && emailNo && rowNo && emailNo !== rowNo;
  if (recordType === 'purchase') {
    const unit = Number(row.unit_purchase_cost_decimal ?? row.unit_purchase_cost);
    return { id: row.id, title: row.product_name, fields: [
      f('product_name', 'Product', row.product_name),
      f('qty_purchased', 'Quantity', String(row.qty_purchased)),
      f('cost', 'Cost', money(unit * row.qty_purchased) && `$${money(unit * row.qty_purchased)}`),
      f('purchase_date', 'Bought', day(row.purchase_date)),
      f('vendor', 'Store', row.vendor?.name),
      f('payment_method', 'Card', cardName(row.payment_method)),
      { ...f('order_number', FIELD_LABELS.order_number, row.order_number), ...(conflict ? { conflict: order.order_number } : {}) },
      f('tracking_number', FIELD_LABELS.tracking_number, row.tracking_number),
      f('carrier', FIELD_LABELS.carrier, row.carrier),
    ] };
  }
  if (recordType === 'sale') {
    const unit = Number(row.unit_price_decimal ?? row.unit_price);
    return { id: row.id, title: row.inventory?.product_name, fields: [
      f('product_name', 'Product', row.inventory?.product_name),
      f('quantity', 'Quantity', String(row.quantity)),
      f('price', 'Sold for', money(unit * row.quantity) && `$${money(unit * row.quantity)}`),
      f('sale_date', 'Sold', day(row.sale_date)),
      f('platform', 'Platform', row.platform?.name),
      f('paid', 'Paid', row.paid_at ? `$${money(row.paid_amount)} on ${day(row.paid_at)}` : null),
      f('tracking_number', FIELD_LABELS.tracking_number, row.tracking_number),
      f('carrier', FIELD_LABELS.carrier, row.carrier),
    ] };
  }
  return { id: row.id, title: row.name, fields: [
    f('name', 'Name', row.name),
    f('amount', 'Amount', `$${money(row.amount_decimal ?? row.amount)}`),
    f('date', 'Date', day(row.date)),
    f('category', 'Category', row.category),
    f('payment_method', 'Card', cardName(row.payment_method)),
  ] };
}

// Labels of the fields linking would fill, per match id, for the order list.
async function willFill(prisma, userId, orders) {
  const out = new Map();
  for (const order of orders) {
    for (const match of order.matches || []) {
      if (match.state !== 'suggested' || match.record_type === 'expense') continue;
      const rows = await loadRecords(prisma, userId, match.record_type, match.record_ids);
      const keys = new Set(rows.flatMap((row) => Object.keys(fillsFor(match.record_type, row, order))));
      out.set(match.id, [...keys].map((k) => FIELD_LABELS[k] || k));
    }
  }
  return out;
}

async function linkPreview(prisma, userId, matchId, settings = {}) {
  const match = await prisma.emailMatch.findFirst({ where: { id: matchId, user_id: userId }, include: { order: true } });
  if (!match) return null;
  const { order } = match;
  const rows = await loadRecords(prisma, userId, match.record_type, match.record_ids);
  if (rows.length !== match.record_ids.length) return null;
  const records = rows.map((row) => recordView(match.record_type, row, order));
  const also = [];
  const cashout = match.record_type === 'sale' && CASHOUTS.has(order.merchant);
  if (cashout && order.status === 'payout' && settings.cashoutPayouts) {
    const unpaid = rows.filter((r) => !r.paid_at).length;
    if (unpaid) also.push(`Marks ${unpaid === 1 ? 'the sale' : `${unpaid} sales`} paid to your ${storeLabel(order.merchant)} balance, from the receipt`);
  }
  if (match.record_type === 'purchase' && settings.updateShipping) also.push('Later emails for this order add tracking and mark it delivered');
  const warnings = [];
  const conflicts = records.filter((r) => r.fields.some((x) => x.conflict));
  if (conflicts.length) {
    warnings.push({ code: 'order_number', text: conflicts.length === records.length && records.length === 1
      ? `Your purchase has a different order number (${conflicts[0].fields.find((x) => x.key === 'order_number').value}). This email is probably for another order.`
      : `${conflicts.length} of these purchases have a different order number. This email is probably for another order.` });
  }
  if (!records.some((r) => r.fields.some((x) => x.fill)) && !also.length) also.push('Nothing on the record changes; the email is just linked to it');
  return {
    match: { id: match.id, record_type: match.record_type, score: match.score, reasons: match.reasons },
    order: {
      store: storeLabel(order.merchant), order_number: order.order_number, total: money(order.total),
      date: day(order.first_seen), status: order.status, tracking: order.tracking_numbers?.[0] || null,
      items: (Array.isArray(order.items) ? order.items : []).map((i) => i?.name).filter(Boolean).slice(0, 6),
    },
    records,
    also,
    warnings,
  };
}

module.exports = { linkPreview, willFill };
