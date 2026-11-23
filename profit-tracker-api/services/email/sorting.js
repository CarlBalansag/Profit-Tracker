// Sorts store orders that match no purchase: resale (add it), personal (set
// aside as Not business), or ask (a To-Do asks). Each gets a reason the user
// can read. Rules, in order:
//   1. The user's own word list ("Purina", "cat food")      -> personal
//   2. Amazon, shipped outside the user's home state         -> resale
//      (cash-outs ship direct: "P4D - MIDDLETOWN, DE")
//   3. An item the user has bought before (their purchases) -> resale
//   4. 2 or more of one item -> resale (Amazon shipped home: ask)
//   5. Amazon, shipped to the home state, none of the above -> personal
//   6. Anything else                                         -> ask
// "kept" (the user said it's business) and "declined" (the user said no to
// the purchase made automatically) are never changed. Cancelled and
// refunded orders aren't sorted.
const { logEvent } = require('../activityLog');
const { itemOverlap } = require('./match');
const { SENDERS } = require('./config');

const SKIP = new Set(['cancelled', 'refund', 'return']);
const labelFor = (merchant) => SENDERS.find((s) => s.key === merchant)?.label || String(merchant || '').replace(/^custom:/, '');
const stateOf = (shipTo) => (String(shipTo || '').match(/,\s*([A-Z]{2})$/) || [])[1] || null;

function sortOrder(order, { homeState, personalWords = [], pastNames = [] }) {
  const items = Array.isArray(order.items) ? order.items.filter((i) => i && i.name) : [];
  const named = items.filter((i) => !i.category && !i.more);
  const text = items.map((i) => i.name).join(' ').toLowerCase();
  const word = personalWords.find((w) => w && text.includes(String(w).toLowerCase()));
  if (word) return { leaning: 'personal', reason: `Has "${word}"` };
  const state = stateOf(order.ship_to);
  const amazon = order.merchant === 'amazon';
  if (amazon && state && homeState && state !== homeState) return { leaning: 'resale', reason: `Ships to ${order.ship_to}` };
  const seen = named.find((i) => pastNames.some((name) => itemOverlap([i], [name]) >= 0.6));
  if (seen) return { leaning: 'resale', reason: 'You\'ve bought this before' };
  const home = amazon && state && homeState && state === homeState;
  if (named.some((i) => Number(i.quantity) >= 2)) {
    const most = Math.max(...named.map((i) => Number(i.quantity) || 1));
    // Shipped home, 2 bottles of vitamins is as likely personal: ask.
    return home ? { leaning: 'ask', reason: `${most} of the same item, shipped to ${order.ship_to}` } : { leaning: 'resale', reason: `${most} of the same item` };
  }
  if (home) return { leaning: 'personal', reason: `Ships to ${order.ship_to}` };
  return { leaning: 'ask', reason: null };
}

async function sortOrders(prisma, userId, settings) {
  const orders = await prisma.emailOrder.findMany({
    where: { user_id: userId, type: 'purchase', match_state: 'unmatched', OR: [{ leaning: null }, { leaning: { notIn: ['kept', 'declined'] } }] },
    take: 300,
  });
  const due = orders.filter((o) => !SKIP.has(o.status));
  if (!due.length) return { resale: 0, personal: 0, ask: 0 };
  const past = await prisma.inventory.findMany({ where: { user_id: userId }, select: { product_name: true }, orderBy: { purchase_date: 'desc' }, take: 2000 });
  const options = {
    homeState: settings.homeState || null,
    personalWords: Array.isArray(settings.personalWords) ? settings.personalWords : [],
    pastNames: past.map((p) => p.product_name).filter(Boolean),
  };
  const summary = { resale: 0, personal: 0, ask: 0 };
  for (const order of due) {
    const { leaning, reason } = sortOrder(order, options);
    summary[leaning] += 1;
    if (leaning === order.leaning && reason === order.leaning_reason) continue;
    if (leaning === 'personal') {
      await prisma.emailOrder.update({ where: { id: order.id }, data: { leaning, leaning_reason: reason, match_state: 'dismissed' } });
      // Shown on the Automation page; "Not business" in Settings > Email brings it back.
      await logEvent(prisma, userId, {
        recordType: 'email_sort', recordId: order.id, action: 'personal', source: 'email',
        name: `${labelFor(order.merchant)} order${order.order_number ? ` ${order.order_number}` : ''}`,
        detail: { reason, total: order.total != null ? String(order.total) : null, items: (order.items || []).map((i) => i.name).slice(0, 5) },
      }).catch(() => {});
    } else {
      await prisma.emailOrder.update({ where: { id: order.id }, data: { leaning, leaning_reason: reason } });
    }
  }
  return summary;
}

module.exports = { sortOrders, sortOrder, stateOf };
