// Statuses that auto-advance once a tracking number is attached to a
// still-pre-shipment record. Extend these sets/maps to grow the pipeline
// further (e.g. auto-advancing again once a carrier confirms delivery).
const INBOUND_AUTO_SHIP_FROM = new Set(['Pre Order', 'PURCHASED']);
const INBOUND_SHIPPED_STATUS = 'SHIPPED_IN';

const OUTBOUND_AUTO_SHIP_FROM = new Set(['SOLD']);
const OUTBOUND_SHIPPED_STATUS = 'SHIPPED_OUT';

// Returns the advanced status for `currentStatus`, or null if it isn't
// eligible (already shipped, already terminal, or an unrelated status).
function autoShippedStatus(kind, currentStatus) {
  if (kind === 'inbound') return INBOUND_AUTO_SHIP_FROM.has(currentStatus) ? INBOUND_SHIPPED_STATUS : null;
  if (kind === 'outbound') return OUTBOUND_AUTO_SHIP_FROM.has(currentStatus) ? OUTBOUND_SHIPPED_STATUS : null;
  return null;
}

module.exports = { autoShippedStatus };
