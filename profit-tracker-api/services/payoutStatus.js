// Single source of truth for "is this sale paid, unpaid, or short-paid".
// Used by the Cash Flow page (routes/analytics.js) and every MCP tool that
// reports or reasons about payment status, so the two can never disagree
// about what counts as paid. Deliberately not a stored column -- see the
// payout_short_amount comment in prisma/schema.prisma.
const { decimal } = require('./money');

// Sales created before paid_at existed (the status-workflow rework) may have
// been marked paid by hand through the legacy status dropdown alone. Treated
// as fully paid with no shortfall -- the same legacy columns
// services/decimalFinance.js's isRealizedSale already leans on.
const LEGACY_PAID_VALUES = new Set(['PAID', 'COMPLETED']);

function isLegacyPaid(sale) {
  return LEGACY_PAID_VALUES.has(String(sale.status || '').toUpperCase())
    || LEGACY_PAID_VALUES.has(String(sale.workflow_status || '').toUpperCase());
}

// Returns 'unpaid' | 'partial' | 'paid'.
function payoutStatus(sale = {}) {
  if (!sale.paid_at && !isLegacyPaid(sale)) return 'unpaid';
  const shortAmount = sale.payout_short_amount !== null && sale.payout_short_amount !== undefined
    ? decimal(sale.payout_short_amount)
    : decimal(0);
  return shortAmount.gt(0) ? 'partial' : 'paid';
}

module.exports = { payoutStatus };
