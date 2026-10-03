// Backfills the additive status-workflow columns from the legacy
// Inventory.status / Sales.status strings. Dry-run by default: without --apply
// it reads, decides, and writes only the report at qa/STATUS_MIGRATION_REPORT.md.
//
//   node scripts/migrateStatusWorkflow.js              # dry run, report only
//   node scripts/migrateStatusWorkflow.js --apply      # also write the columns
//   node scripts/migrateStatusWorkflow.js --report path/to/report.md
//
// The legacy `status` columns are never modified or dropped here, so this is
// safe to re-run and safe to leave half-resolved: ambiguous rows keep their
// legacy status and a NULL new status until a human decides.
const fs = require('node:fs');
const path = require('node:path');
const {
  INVENTORY_RECEIVING_STATUSES,
  SALE_STATUSES_BY_WORKFLOW,
  SALE_EXCEPTION_STATUSES,
} = require('../services/statusTransitions');

// The complete legacy vocabulary, from validation/schemas.js. Any stored value
// outside these lists is reported as ambiguous rather than guessed at.
const LEGACY_INVENTORY_STATUSES = ['Pre Order', 'On Hand', 'PURCHASED', 'SHIPPED_IN', 'DELIVERED', 'SCANNED_IN', 'LISTED', 'SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];
const LEGACY_SALE_STATUSES = ['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED', 'RETURNED', 'DISPUTED', 'CANCELLED'];

// Legacy inventory statuses that only ever described a *sale*. The plan is
// explicit that these must not be mapped to a receiving status directly.
const SALE_ONLY_INVENTORY_STATUSES = ['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'PAID', 'COMPLETED'];

// Platform.type -> sale workflow preset. 'Vendor' platforms never sell, so they
// fall through to the standard default.
const WORKFLOW_BY_PLATFORM_TYPE = { Marketplace: 'STANDARD_MARKETPLACE', Cashout: 'CASHOUT' };
const DEFAULT_WORKFLOW = 'STANDARD_MARKETPLACE';

const mapped = (row, table, rule, data, extra = {}) =>
  ({ id: row.id, table, legacy_status: row.status, qty_on_hand: row.qty_on_hand, ambiguous: false, rule, data, ...extra });

const ambiguous = (row, table, reason, extra = {}) =>
  ({ id: row.id, table, legacy_status: row.status, qty_on_hand: row.qty_on_hand, ambiguous: true, reason, data: null, ...extra });

/**
 * Pure decision for one Inventory row. No database access, no clock.
 * `row` needs { id, status, qty_on_hand, received_date, sales: [{ id }] }.
 */
function mapInventoryRow(row = {}) {
  const sales = Array.isArray(row.sales) ? row.sales : [];
  const saleIds = sales.map((sale) => sale.id);
  const linked = { linked_sale_ids: saleIds };
  const status = row.status;
  // Real evidence only: never fabricate a received_at from the migration clock.
  const receivedAt = row.received_date || null;
  const onHand = (rule) => mapped(row, 'Inventory', rule, { receiving_status: 'ON_HAND', received_at: receivedAt }, linked);

  if (!LEGACY_INVENTORY_STATUSES.includes(status)) {
    return ambiguous(row, 'Inventory', 'Status is outside the known legacy inventory vocabulary', linked);
  }

  if (SALE_ONLY_INVENTORY_STATUSES.includes(status)) {
    // A linked sale proves the purchase itself succeeded, so the receiving side
    // is ON_HAND and the sale row carries the sale-side status independently.
    if (saleIds.length === 0) {
      return ambiguous(row, 'Inventory', `Sale-only legacy status "${status}" with no linked sale to reconstruct from`, linked);
    }
    return onHand(row.qty_on_hand === 0 ? 'sale_only_sold_out_with_linked_sale' : 'sale_only_partial_with_linked_sale');
  }

  switch (status) {
    case 'Pre Order':
      return mapped(row, 'Inventory', 'pre_order', { receiving_status: 'PRE_ORDER' }, linked);
    case 'PURCHASED':
      return mapped(row, 'Inventory', 'purchased', { receiving_status: 'PURCHASED' }, linked);
    case 'SHIPPED_IN':
      return mapped(row, 'Inventory', 'shipped_in_to_inbound', { receiving_status: 'INBOUND' }, linked);
    case 'On Hand':
      return onHand('on_hand');
    case 'DELIVERED':
      return onHand('delivered_to_on_hand');
    case 'SCANNED_IN':
      // SCANNED_IN survives only as a cash-out *sale* step. On inventory it
      // always meant "the item is physically here".
      return onHand('scanned_in_to_on_hand');
    case 'LISTED':
      // Listing is an attribute, so LISTED becomes a receiving status plus
      // is_listed. A legacy listing always implied possession.
      return mapped(row, 'Inventory', 'listed', { receiving_status: 'ON_HAND', received_at: receivedAt, is_listed: true }, linked);
    case 'RETURNED':
    case 'DISPUTED':
      // The exception itself stays recorded in the legacy status column. Units
      // still on hand are evidence the purchase arrived; zero units are not.
      if (row.qty_on_hand > 0) return onHand(`${status.toLowerCase()}_with_stock_on_hand`);
      return ambiguous(row, 'Inventory', `Legacy "${status}" with no units on hand: cannot tell whether the purchase was ever received`, linked);
    case 'CANCELLED':
      // A cancelled purchase needs both a receiving status and a cancelled_at,
      // and no historical cancellation date exists anywhere in the old schema.
      return ambiguous(row, 'Inventory', 'Legacy "CANCELLED" has no receiving-status equivalent and no recorded cancellation date', linked);
    default:
      return ambiguous(row, 'Inventory', `Unhandled legacy status "${status}"`, linked);
  }
}

/**
 * Pure decision for one Sales row. No database access.
 * `row` needs { id, status, payout_date, platform: { type } }.
 * `now` is the comparison point for "payout_date in the past".
 */
function mapSaleRow(row = {}, now = new Date()) {
  const status = row.status;
  const platformType = row.platform ? row.platform.type : null;
  // AUTHENTICATION is itself proof the sale ran an authentication workflow;
  // otherwise the platform's type is the only evidence available.
  const workflow = status === 'AUTHENTICATION'
    ? 'AUTH_MARKETPLACE'
    : (WORKFLOW_BY_PLATFORM_TYPE[platformType] || DEFAULT_WORKFLOW);
  const payoutDate = row.payout_date ? new Date(row.payout_date) : null;
  const payoutPassed = Boolean(payoutDate) && payoutDate.getTime() <= new Date(now).getTime();
  const base = { workflow_type: workflow };
  const to = (rule, data) => mapped(row, 'Sales', rule, { ...base, ...data });

  if (!LEGACY_SALE_STATUSES.includes(status)) {
    return ambiguous(row, 'Sales', 'Status is outside the known legacy sale vocabulary');
  }

  switch (status) {
    case 'SOLD':
      // Both AWAITING_SHIPMENT and AWAITING_HANDOFF are "sold, nothing sent
      // yet"; only a DIRECT_LOCAL workflow uses the handoff wording, and legacy
      // data has no way to express that, so every row lands on the ship path.
      return to('sold_to_awaiting_shipment', { workflow_status: 'AWAITING_SHIPMENT' });
    case 'SHIPPED_OUT':
      return to('shipped_out_to_outbound', { workflow_status: 'OUTBOUND' });
    case 'AUTHENTICATION':
      return to('authentication_to_authenticating', { workflow_status: 'AUTHENTICATING' });
    case 'PAID':
      // Legacy PAID means paid. payout_date is the only date evidence; without
      // it paid_at stays NULL rather than being invented.
      return to('paid', { workflow_status: 'PAID', paid_at: payoutDate });
    case 'COMPLETED':
      // COMPLETED was a catch-all. Only promote it to PAID with independent
      // evidence of an actual payout.
      if (!payoutPassed) {
        return ambiguous(row, 'Sales', payoutDate
          ? 'Legacy "COMPLETED" with a payout_date still in the future: no evidence payment arrived'
          : 'Legacy "COMPLETED" with no payout_date: no independent evidence of payment');
      }
      return to('completed_to_paid_with_payout_evidence', { workflow_status: 'PAID', paid_at: payoutDate });
    case 'RETURNED':
      return to('returned', { workflow_status: 'RETURNED' });
    case 'DISPUTED':
      return to('disputed', { workflow_status: 'DISPUTED' });
    case 'CANCELLED':
      return to('cancelled', { workflow_status: 'CANCELLED' });
    default:
      return ambiguous(row, 'Sales', `Unhandled legacy status "${status}"`);
  }
}

// Guard against a mapping rule ever producing a value outside the registry.
const VALID_SALE_STATUSES = new Set([
  ...Object.values(SALE_STATUSES_BY_WORKFLOW).flat(),
  ...SALE_EXCEPTION_STATUSES,
]);

function assertMappedValues(decisions) {
  for (const decision of decisions) {
    if (decision.ambiguous) continue;
    const { receiving_status, workflow_status } = decision.data;
    if (receiving_status && !INVENTORY_RECEIVING_STATUSES.includes(receiving_status)) {
      throw new Error(`Rule "${decision.rule}" produced unknown receiving status ${receiving_status}`);
    }
    if (workflow_status && !VALID_SALE_STATUSES.has(workflow_status)) {
      throw new Error(`Rule "${decision.rule}" produced unknown sale status ${workflow_status}`);
    }
  }
}

const countByRule = (decisions) => decisions.reduce((counts, decision) => {
  if (decision.ambiguous) return counts;
  counts[decision.rule] = (counts[decision.rule] || 0) + 1;
  return counts;
}, {});

const escapeCell = (value) => String(value === null || value === undefined ? '' : value).replace(/\|/g, '\\|');

function buildReport({ decisions, apply, now }) {
  const inventory = decisions.filter((decision) => decision.table === 'Inventory');
  const sales = decisions.filter((decision) => decision.table === 'Sales');
  const unresolved = decisions.filter((decision) => decision.ambiguous);
  const ruleTable = (rows) => {
    const counts = countByRule(rows);
    const names = Object.keys(counts).sort();
    if (!names.length) return '_No rows auto-mapped._\n';
    return ['| Rule | Rows |', '| --- | --- |', ...names.map((name) => `| ${name} | ${counts[name]} |`)].join('\n') + '\n';
  };

  return `# Status workflow — legacy status migration report

Generated: ${new Date(now).toISOString()}
Mode: ${apply ? '**applied** (new columns written)' : 'dry run (no database writes)'}
Script: \`selvora-api/scripts/migrateStatusWorkflow.js\`
Mapping rules: \`future_plans/STATUS_WORKFLOW_PLAN.md\` § Legacy status migration

The legacy \`Inventory.status\` and \`Sales.status\` columns are not modified or
dropped by this script. Every ambiguous row below must be resolved by a human
before any future change drops them.

## Totals

| Table | Rows considered | Auto-mapped | Ambiguous |
| --- | --- | --- | --- |
| Inventory | ${inventory.length} | ${inventory.length - inventory.filter((d) => d.ambiguous).length} | ${inventory.filter((d) => d.ambiguous).length} |
| Sales | ${sales.length} | ${sales.length - sales.filter((d) => d.ambiguous).length} | ${sales.filter((d) => d.ambiguous).length} |
| **Total** | **${decisions.length}** | **${decisions.length - unresolved.length}** | **${unresolved.length}** |

## Inventory rows auto-mapped per rule

${ruleTable(inventory)}
## Sales rows auto-mapped per rule

${ruleTable(sales)}
## Ambiguous rows needing a human decision

${unresolved.length === 0 ? '_None._\n' : ['| Table | Row id | Legacy status | qty_on_hand | Linked sale ids | Why |', '| --- | --- | --- | --- | --- | --- |',
    ...unresolved.map((decision) => `| ${decision.table} | ${escapeCell(decision.id)} | ${escapeCell(decision.legacy_status)} | ${escapeCell(decision.qty_on_hand)} | ${escapeCell((decision.linked_sale_ids || []).join(', '))} | ${escapeCell(decision.reason)} |`)].join('\n') + '\n'}`;
}

/**
 * Reads every Inventory and Sales row, decides each one with the pure mappers
 * above, writes the report, and -- only with --apply -- writes the new columns.
 */
async function migrateStatusWorkflow({ prisma, args = [], fileSystem = fs, outputLog = console.log, now = new Date() }) {
  const apply = args.includes('--apply');
  const reportFlag = args.indexOf('--report');
  const reportPath = reportFlag >= 0 && args[reportFlag + 1] && !args[reportFlag + 1].startsWith('--')
    ? args[reportFlag + 1]
    : path.resolve(__dirname, '../../qa/STATUS_MIGRATION_REPORT.md');

  const inventoryRows = await prisma.inventory.findMany({
    select: { id: true, user_id: true, status: true, qty_on_hand: true, received_date: true, sales: { select: { id: true } } },
  });
  const saleRows = await prisma.sales.findMany({
    select: { id: true, status: true, payout_date: true, quantity: true, platform: { select: { type: true } } },
  });

  const decisions = [
    ...inventoryRows.map((row) => mapInventoryRow(row)),
    ...saleRows.map((row) => mapSaleRow(row, now)),
  ];
  assertMappedValues(decisions);

  const report = buildReport({ decisions, apply, now });
  fileSystem.writeFileSync(reportPath, report, 'utf8');

  const summary = {
    dryRun: !apply,
    inventoryRows: inventoryRows.length,
    saleRows: saleRows.length,
    autoMapped: decisions.filter((decision) => !decision.ambiguous).length,
    ambiguous: decisions.filter((decision) => decision.ambiguous).length,
    report: reportPath,
  };

  if (!apply) {
    outputLog(JSON.stringify(summary));
    return summary;
  }

  // One transaction so a failure part-way leaves no half-backfilled table.
  // Each write is guarded on the legacy status the decision was made from, so a
  // row edited after it was read is skipped rather than overwritten.
  // Each decision is its own network round-trip to the database, which can run
  // well past Prisma's 5s default interactive-transaction timeout once there
  // are more than a couple dozen rows (seen in practice against a remote Neon
  // database: the transaction expired mid-run with 107 rows). The timeout
  // below scales with row count instead of guessing a single fixed value.
  let written = 0;
  let skipped = 0;
  const applicable = decisions.filter((decision) => !decision.ambiguous);
  const timeout = Math.max(10_000, applicable.length * 500);
  await prisma.$transaction(async (tx) => {
    for (const decision of applicable) {
      const model = decision.table === 'Inventory' ? tx.inventory : tx.sales;
      const result = await model.updateMany({
        where: { id: decision.id, status: decision.legacy_status },
        data: decision.data,
      });
      if (result.count === 1) written += 1;
      else skipped += 1;
    }
  }, { timeout });

  outputLog(JSON.stringify({ ...summary, written, skippedChangedRows: skipped }));
  return { ...summary, written, skippedChangedRows: skipped };
}

module.exports = { migrateStatusWorkflow, mapInventoryRow, mapSaleRow, LEGACY_INVENTORY_STATUSES, LEGACY_SALE_STATUSES };

if (require.main === module) {
  const prisma = require('../prisma');
  migrateStatusWorkflow({ prisma, args: process.argv.slice(2) })
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
