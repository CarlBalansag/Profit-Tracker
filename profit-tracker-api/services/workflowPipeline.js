// The Dashboard's Status Pipeline per sale workflow: for Cash-out and for
// Marketplace, how many units sit in each step of that workflow right now,
// the money they hold (what the buyer pays for them), and the most recent
// items in each step. Display only: nothing here writes a record.
const { decimal, keptSaleQuantity } = require('./decimalFinance');
const {
  SALE_STATUSES_BY_WORKFLOW,
  resolveSaleWorkflow,
  legacyWorkflowStatus,
} = require('./statusTransitions');

// How many items each stage lists. The count and value always cover them all.
const ITEMS_PER_STAGE = 20;

// Which sale workflows each pipeline view covers, and the steps it shows.
// Marketplace covers the standard, authenticated and local-handoff paths; the
// steps only some of them use (authentication, handoff) show only when an item
// is actually in them.
const VIEWS = {
  cashout: {
    workflows: ['CASHOUT'],
    stages: SALE_STATUSES_BY_WORKFLOW.CASHOUT,
    optional: [],
  },
  marketplace: {
    workflows: ['STANDARD_MARKETPLACE', 'AUTH_MARKETPLACE', 'DIRECT_LOCAL'],
    stages: ['AWAITING_SHIPMENT', 'AWAITING_HANDOFF', 'OUTBOUND', 'HANDED_OVER', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING', 'WAITING_FOR_PAYMENT', 'PAID'],
    optional: ['AWAITING_HANDOFF', 'HANDED_OVER', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING'],
  },
};

const money = (d) => d.toDecimalPlaces(2).toNumber();

// The sale's workflow: its own, else its platform's preset, else standard.
const workflowOf = (sale) => resolveSaleWorkflow(sale.workflow_type || sale.platform?.workflow_preset);

// The sale's step: its workflow status, or for a row from before the status
// workflow, the step its legacy status stands for.
const stageOf = (sale, workflow) => sale.workflow_status || legacyWorkflowStatus(sale.status, workflow);

function buildWorkflowPipelines(sales = []) {
  const result = {};
  for (const [key, view] of Object.entries(VIEWS)) {
    const byStage = new Map(view.stages.map((status) => [status, { status, count: 0, value: decimal(0), items: [] }]));

    for (const sale of sales) {
      const workflow = workflowOf(sale);
      if (!view.workflows.includes(workflow)) continue;
      const stage = byStage.get(stageOf(sale, workflow));
      if (!stage) continue; // cancelled, returned, disputed: not a step of the path
      const quantity = keptSaleQuantity(sale);
      if (quantity <= 0) continue;
      const value = decimal(sale.unit_price || 0).times(quantity);
      stage.count += quantity;
      stage.value = stage.value.plus(value);
      stage.items.push({
        saleId: sale.id,
        inventoryId: sale.inventory_id,
        name: sale.inventory?.product_name || 'Item',
        buyer: sale.platform?.name || 'Direct',
        quantity,
        value: money(value),
        since: sale.workflow_status_changed_at || sale.sale_date || null,
      });
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
