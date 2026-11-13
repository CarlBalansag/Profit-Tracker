// The Dashboard's Status Pipeline, as steps: for everything ("all"), for
// Cash-out and for Marketplace, how many units sit in each step right now, the
// money they hold, and the most recent items in each step. Display only:
// nothing here writes a record.
//
// Sold units are worth what the buyer pays for them. The "all" view also starts
// with the unsold stock (Pre-order, Purchased, Inbound, On Hand), worth what it
// cost, since that stock isn't tied to Cash-out or Marketplace yet.
const { decimal, keptSaleQuantity, allocatedCost } = require('./decimalFinance');
const {
  SALE_STATUSES_BY_WORKFLOW,
  INVENTORY_RECEIVING_STATUSES,
  LEGACY_TO_RECEIVING_STATUS,
  resolveSaleWorkflow,
  legacyWorkflowStatus,
} = require('./statusTransitions');

// How many items each stage lists. The count and value always cover them all.
const ITEMS_PER_STAGE = 20;

// The steps each view shows, in order. Steps in `optional` show only when
// something is in them (a workflow the user may not use at all).
const VIEWS = {
  all: {
    stock: true,
    sales: ['cashout', 'marketplace'],
    stages: [
      ...INVENTORY_RECEIVING_STATUSES,
      'AWAITING_SHIPMENT', 'AWAITING_HANDOFF', 'OUTBOUND', 'HANDED_OVER',
      'DELIVERED_TO_PROVIDER', 'DELIVERED_TO_AUTHENTICATOR', 'WAITING_FOR_SCAN_IN', 'SCANNED_IN',
      'ACCEPTED', 'AUTHENTICATING', 'WAITING_FOR_PAYMENT', 'PAID',
    ],
    optional: ['PRE_ORDER', 'AWAITING_HANDOFF', 'HANDED_OVER', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING'],
  },
  cashout: {
    sales: ['cashout'],
    stages: SALE_STATUSES_BY_WORKFLOW.CASHOUT,
    optional: [],
  },
  marketplace: {
    sales: ['marketplace'],
    stages: ['AWAITING_SHIPMENT', 'AWAITING_HANDOFF', 'OUTBOUND', 'HANDED_OVER', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING', 'WAITING_FOR_PAYMENT', 'PAID'],
    optional: ['AWAITING_HANDOFF', 'HANDED_OVER', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING'],
  },
};

const money = (d) => d.toDecimalPlaces(2).toNumber();

// Which kind of sale this is: sold to a Cashout platform, or anything else
// (a marketplace, or no platform). The same split the dashboard's
// Cashout/Marketplace filter makes. Not the sale's workflow_type: many older
// cash-out sales carry the standard-marketplace default there.
const kindOf = (sale) => (sale.platform?.type === 'Cashout' ? 'cashout' : 'marketplace');

// The sale's workflow, for placing a row from before the status workflow: its
// own, else its platform's preset, else the one its kind implies.
const workflowOf = (sale) => resolveSaleWorkflow(
  sale.workflow_type || sale.platform?.workflow_preset || (kindOf(sale) === 'cashout' ? 'CASHOUT' : null),
);

// The sale's step: its workflow status, or for a row from before the status
// workflow, the step its legacy status stands for.
const saleStageOf = (sale) => sale.workflow_status || legacyWorkflowStatus(sale.status, workflowOf(sale));

// Unsold stock's step: its receiving status, else what its legacy status
// stands for, else Purchased.
const stockStageOf = (inventory) =>
  inventory.receiving_status || LEGACY_TO_RECEIVING_STATUS[inventory.status] || 'PURCHASED';

function saleEntry(sale) {
  const quantity = keptSaleQuantity(sale);
  if (quantity <= 0) return null;
  const value = decimal(sale.unit_price || 0).times(quantity);
  return {
    stage: saleStageOf(sale),
    quantity,
    value,
    item: {
      id: `sale-${sale.id}`,
      saleId: sale.id,
      inventoryId: sale.inventory_id,
      name: sale.inventory?.product_name || 'Item',
      party: sale.platform?.name || 'Direct',
      quantity,
      since: sale.workflow_status_changed_at || sale.sale_date || null,
    },
  };
}

function stockEntry(inventory) {
  const quantity = Number(inventory.qty_on_hand) || 0;
  if (quantity <= 0) return null;
  const value = allocatedCost(inventory, quantity);
  return {
    stage: stockStageOf(inventory),
    quantity,
    value,
    item: {
      id: `inventory-${inventory.id}`,
      inventoryId: inventory.id,
      name: inventory.product_name || 'Item',
      party: inventory.vendor?.name || null,
      quantity,
      since: inventory.receiving_status_changed_at || inventory.purchase_date || null,
    },
  };
}

/**
 * @param sales the dashboard's sales (already mode/date filtered)
 * @param stock unsold inventory for the "all" view's first steps; pass [] when
 *   the dashboard is filtered to Cashout or Marketplace, since stock belongs to
 *   neither yet
 */
function buildWorkflowPipelines(sales = [], stock = []) {
  const saleEntries = sales.map((sale) => ({ kind: kindOf(sale), entry: saleEntry(sale) })).filter((s) => s.entry);
  const stockEntries = stock.map(stockEntry).filter(Boolean);

  const result = {};
  for (const [key, view] of Object.entries(VIEWS)) {
    const byStage = new Map(view.stages.map((status) => [status, { status, count: 0, value: decimal(0), items: [] }]));
    const entries = [
      ...(view.stock ? stockEntries : []),
      ...saleEntries.filter((s) => view.sales.includes(s.kind)).map((s) => s.entry),
    ];

    for (const { stage: status, quantity, value, item } of entries) {
      const stage = byStage.get(status);
      if (!stage) continue; // cancelled, returned, disputed: not a step of the path
      stage.count += quantity;
      stage.value = stage.value.plus(value);
      stage.items.push({ ...item, value: money(value) });
    }

    const stages = [...byStage.values()]
      .filter((stage) => !view.optional.includes(stage.status) || stage.count > 0)
      .map((stage) => {
        const items = stage.items
          .sort((a, b) => new Date(b.since || 0) - new Date(a.since || 0))
          .slice(0, ITEMS_PER_STAGE);
        return {
          status: stage.status,
          count: stage.count,
          value: money(stage.value),
          itemCount: stage.items.length,
          items,
        };
      });
    result[key] = { stages };
  }
  return result;
}

module.exports = { buildWorkflowPipelines, ITEMS_PER_STAGE };
