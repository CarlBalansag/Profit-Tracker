// What the "Returning everything" checkbox in RefundsPanel fills in. It is only
// a prefill -- every field stays editable -- but the numbers it suggests must
// never be ones the server would refuse (services/refunds.js caps the running
// refund total at the purchase cost / sale price).
import { grossBatchCost } from '../../../shared/finance.mjs';

const num = (value) => Number(value) || 0;
const round2 = (value) => Math.round(value * 100) / 100;

// What one unit cost / sold for, as the refund would count it.
//   purchase -> item price plus its share of the sales tax: what a store gives
//               back on a return. Inbound shipping and fees stay a cost.
//   sale     -> the price the buyer paid per unit.
export function refundUnitPrice(kind, record = {}) {
  if (kind === 'purchase') {
    const qty = num(record.qty_purchased) || 1;
    return round2(num(record.unit_purchase_cost) + num(record.sales_tax) / qty);
  }
  return round2(num(record.unit_price));
}

// The most money still refundable on the record.
function refundCap(kind, record) {
  const ceiling = kind === 'purchase'
    ? grossBatchCost(record)
    : num(record.unit_price) * num(record.quantity);
  return Math.max(0, round2(ceiling - num(record.refunded_amount)));
}

// units: how many units the refund covers (all that can still come back).
// keep:  the units stay with whoever has them (purchase: you kept them and are
//        still selling; sale: the buyer kept them), so none move in stock.
export function fullRefundPrefill(kind, record = {}, units = 0, { keep = false } = {}) {
  const covered = Math.max(0, Math.floor(num(units)));
  const amount = Math.min(round2(refundUnitPrice(kind, record) * covered), refundCap(kind, record));
  return { amount: amount.toFixed(2), quantity: String(keep ? 0 : covered) };
}
