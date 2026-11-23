// Structured data some stores embed in their emails for Gmail's order cards:
// schema.org Order, ParcelDelivery and Invoice as JSON-LD. When present it is
// the most reliable source, so its fields win over text matching.
const { money } = require('./generic');

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html || '')) !== null && out.length < 20) {
    try {
      const parsed = JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ''));
      const list = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const node of list) if (node && typeof node === 'object') out.push(node);
    } catch { /* not JSON; ignore */ }
  }
  return out;
}

const typeOf = (node) => String(node['@type'] || '').replace(/^https?:\/\/schema\.org\//, '');
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v) => (v == null || v === '' ? null : money(typeof v === 'object' ? v.price ?? v.value : v));

const STATUS = {
  OrderProcessing: 'order', OrderPaymentDue: 'order', OrderInTransit: 'shipped', OrderDelivered: 'delivered',
  OrderPickupAvailable: 'pickup', OrderCancelled: 'cancelled', OrderReturned: 'return', OrderProblem: 'order',
};

function fromSchemaOrg(html) {
  const result = { fields: {}, items: [], tracking: [] };
  for (const node of jsonLdBlocks(html)) {
    const type = typeOf(node);
    if (type === 'Order') {
      if (node.orderNumber) result.fields.order_number = String(node.orderNumber).toUpperCase();
      const status = String(node.orderStatus || '').split('/').pop();
      if (STATUS[status]) result.fields.kind = STATUS[status];
      else result.fields.kind = result.fields.kind || 'order';
      const total = num(node.totalPaymentDue) ?? num(node.price);
      if (total != null) result.fields.total = total;
      if (node.priceCurrency) result.fields.currency = String(node.priceCurrency).toUpperCase().slice(0, 3);
      for (const offer of asArray(node.acceptedOffer)) {
        const item = offer.itemOffered || {};
        const name = item.name || offer.name;
        if (!name) continue;
        const quantity = Number(offer.eligibleQuantity?.value ?? offer.eligibleQuantity ?? 1) || 1;
        const unit = num(offer.price);
        result.items.push({ name: String(name).slice(0, 300), quantity, unit_price: unit, total: unit != null ? (Number(unit) * quantity).toFixed(2) : null });
      }
      const payment = node.paymentMethod?.name || node.paymentMethodId;
      if (payment && /\d{4}/.test(payment)) result.fields.payment_hint = String(payment).slice(0, 40);
    } else if (type === 'ParcelDelivery') {
      if (node.trackingNumber) result.tracking.push(String(node.trackingNumber).replace(/\s+/g, '').toUpperCase());
      const order = node.partOfOrder || {};
      if (order.orderNumber && !result.fields.order_number) result.fields.order_number = String(order.orderNumber).toUpperCase();
      const status = String(node.deliveryStatus?.name || order.orderStatus || '').split('/').pop();
      if (STATUS[status]) result.fields.kind = STATUS[status];
      else if (!result.fields.kind) result.fields.kind = 'shipped';
    } else if (type === 'Invoice') {
      const total = num(node.totalPaymentDue);
      if (total != null) result.fields.total = total;
      if (node.confirmationNumber) result.fields.order_number = String(node.confirmationNumber).toUpperCase();
      result.fields.kind = result.fields.kind || 'receipt';
    }
  }
  return result;
}

module.exports = { fromSchemaOrg, jsonLdBlocks };
