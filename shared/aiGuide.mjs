// The guide that teaches a person's AI assistant how to use the Profit Tracker
// MCP tools. People copy it from Settings > AI Assistant > Keep your AI up to
// date, and a connected AI pulls it with the get_ai_guide MCP tool, which
// remembers per API key the version that AI last read.
//
// Two parts, kept up to date together:
//   AI_GUIDE_BODY     how everything works *now* -- the full guide for someone
//                     setting up an AI for the first time. Rewrite it in place
//                     when a tool changes; it is not a history.
//   AI_GUIDE_UPDATES  short per-version notes, newest first, so someone whose AI
//                     already knows an older version copies only what changed.
//
// Versions follow What's New (src/data/changelog.js), but only pushes that change
// what an AI can do over MCP get an entry. AI_GUIDE_VERSION is always the newest
// entry's version. AGENTS.md says when to add one; the API test
// profit-tracker-api/test/aiGuide.test.mjs fails if a tool is missing from the
// guide or the versions are out of order.

export const AI_GUIDE_UPDATES = [
  {
    version: '1.45',
    date: '2026-11-20',
    notes: [
      'Payout fields: payout_date is when the money arrived (paid_at), not an expected date; use payout_status, not status, to tell if a sale was paid. "buyer" means the marketplace/cashout.',
      'update_shipment now refuses PAID for a sale. Use mark_sale_paid, which also fills in payout details on a sale already PAID with none recorded, and is one Activity entry per deposit (undo_activity reverses the whole deposit).',
      'New read-only tools: find_records, reconcile_transactions, list_all_costs, data_quality_report, match_deposit.',
      'add_expense takes notes and external_id (a bank/Copilot transaction id; a repeat returns already_recorded: true and adds nothing). New update_expense. New expense category PROXY.',
    ],
  },
];

export const AI_GUIDE_VERSION = AI_GUIDE_UPDATES[0].version;

export const AI_GUIDE_BODY = `WHAT THIS IS
Profit Tracker records a reseller's purchases (inventory), sales, payouts, expenses, credit cards and cashout deals. You reach it through MCP tools. This guide covers how the data works, the rules for changing it, and every tool.

GROUND RULES
- At the start of each session, call get_ai_guide with no arguments. It returns only what changed since you last read this guide, or that you are up to date.
- Before any tool that changes data, tell the user exactly what you will record and wait for their OK. Read-only tools are always fine.
- Every add/edit returns an activity_id. Keep it: undo_activity can reverse that change for 30 days.
- Never invent ids. Get them from list_*, search or find_records.
- Dates are YYYY-MM-DD. Money is in dollars.
- Before adding a purchase or sale, run find_records (order number, tracking number, or product name) so you don't create a duplicate.

HOW THE DATA FITS TOGETHER
- A purchase (inventory row) is one order of an item: qty, unit cost, store, card used, plus optional sales tax, inbound shipping, fees and gift card. Its total cost is worked out, never stored: unit_cost x qty + tax + shipping + fees - gift card - store refunds. To change it, change those parts.
- A sale belongs to one purchase (inventory_id / purchase_id) and sells some of its units on a platform.
- "buyer" in these tools means the sale's platform -- the marketplace or cashout (eBay, Windy City...), not a person.
- A sale's net = sale price x qty - platform fee - shipping label - refunds to the buyer. That is what it should pay out.
- Profit = net - cost of the units sold (+ card cashback for net profit). Profit uses net, never the payout amount, so a short payment shows up as money owed, not lower profit.
- Cancelled, returned and disputed sales count toward no totals.

SALE STATUS VS PAYMENT
- status is the workflow step. Depending on the platform's workflow: AWAITING_SHIPMENT -> OUTBOUND -> WAITING_FOR_PAYMENT -> PAID (marketplaces; authenticated ones add DELIVERED_TO_AUTHENTICATOR and AUTHENTICATING; cashouts add DELIVERED_TO_PROVIDER, WAITING_FOR_SCAN_IN, SCANNED_IN and ACCEPTED), or AWAITING_HANDOFF -> HANDED_OVER -> WAITING_FOR_PAYMENT -> PAID (local deals). Exceptions: CANCELLED, RETURN_IN_PROGRESS, RETURNED, DISPUTED, AUTHENTICATION_FAILED.
- payout_status answers "was I paid": unpaid, partial (paid but short; payout_short_amount says by how much) or paid. Always use payout_status for this, not status.
- payout_date = the day the money arrived. payout_amount = this sale's share of the deposit. payout_account = where it landed. payout_reference = a note identifying the deposit.
- There is no separate deposit record: one deposit covering several sales shows as the same payout_date, payout_account and payout_reference on each.
- A "paid" sale with an empty payout_date was marked paid by a status change alone, so no payment was recorded. mark_sale_paid can fill it in.

RECORDING A PAYOUT
1. match_deposit with the deposit amount and date (plus platform or account if known). It suggests which unpaid sales add up to it.
2. Confirm the combination with the user (if nothing matches exactly, show the closest options).
3. mark_sale_paid ONCE for the whole deposit: all its sale_ids, the deposit date, the FULL deposit amount (not per sale), payout_account, and a payout_reference.
- A deposit smaller than the sales' total: the shortfall is split across them and recorded. Don't edit prices to make it balance.
- A deposit larger than the total: the extra is not recorded anywhere. Tell the user.
- mark_sale_paid works on sales that are OUTBOUND, AWAITING_HANDOFF, HANDED_OVER or WAITING_FOR_PAYMENT, and on PAID sales with no payment recorded. It refuses sales not yet shipped and sales already paid.
- Known gap: a later top-up on a short-paid (partial) sale can't be recorded yet. Tell the user instead of working around it.
- Never mark a sale paid with update_shipment; it refuses PAID.

EXPENSES
- add_expense is only for general business costs (supplies, software, memberships, proxies...). Tax, shipping and fees for one purchase, and a sale's label or platform fee, belong on that purchase or sale (update_purchase / update_sale) -- they already appear in costs and profit.
- Categories: CREDIT_CARD_FEE, MEMBERSHIP, SHIPPING_SUPPLIES, SOFTWARE, PROXY, OTHER (labels like "Proxies" are converted). Other text is stored as typed.
- When importing from a bank or Copilot, ALWAYS pass the transaction id as external_id. If it is already recorded, nothing is added and you get already_recorded: true, so repeating an import is safe.

RECONCILING A STATEMENT
- reconcile_transactions takes bank/card lines {id, date, amount, merchant, account}. Amount signs don't matter. Match tiers, best first: external_id, amount_date (same amount, date within tolerance), amount (same amount, further off), merchant (similar merchant, amount within 10% -- a guess; confirm it). It also lists lines that matched nothing and tracker records with no bank line.

TOOLS -- READ ONLY
- get_ai_guide: this guide, or only what changed since you last read it.
- list_sales: sales by date range, platform (buyer) or payout_status, with net, fees, cost and payout fields.
- list_inventory: purchases, paged; filter by receiving status, availability, or return window closing soon.
- list_expenses: manual expenses, with notes and external_id.
- list_all_costs: every cost in a date range -- manual expenses plus purchase and sale costs -- with totals by month, category and source. Purchase/sale lines are already in profit; never re-add them as expenses.
- get_cashflow_summary: owed to the user, spend, stock value, market value, by platform.
- get_unpaid_by_buyer: money still owed, grouped by platform.
- get_item_profit: profit for one purchase, one sale, or every purchase of a product.
- list_shipments: inbound purchases and outbound sales still in transit.
- get_card_net_to_pay: per card, what is still owed after rewards, the due date, rewards earned.
- list_payment_methods: saved cards and how each earns (cash back or points).
- search_card_list: the built-in list of ~390 US cards, to get a card_id.
- list_store_accounts: saved store logins (e.g. two Amazon accounts) to pass as account on purchases.
- search: text search across purchases, sales and notes.
- find_records: purchases and sales by order number, tracking number, ASIN/UPC (kept in names or notes) or product name. Use before adding.
- reconcile_transactions: match statement lines to records (see above).
- match_deposit: which unpaid sales add up to a deposit (see above).
- data_quality_report: records that need a look, grouped by issue (missing order numbers or tracking, PAID with no payment, $0 cost, shared tracking numbers, no platform, possible duplicates, notes that contradict payment). Show the findings before fixing anything.
- list_activity: the Activity log, and whether each entry can still be undone.
- list_changes: field-level history of edits, with old values.
- list_refunds: refunds on one purchase or sale.
- list_notes, list_attachments: notes and attached links on purchases and sales.
- list_cashout_connections, list_cashout_deals, get_cashout_deal, get_cashout_opportunity_summary, list_cashout_commitments, list_cashout_tracking_submissions: cashout services, live deals (re-check one with get_cashout_deal right before buying), commitments and submitted tracking.
- sync_cashout_deals: refresh live deals now; never buys or logs anything.

TOOLS -- CHANGE DATA (confirm with the user first)
- add_purchase, update_purchase: log or edit a purchase. The store is created if new; the card must already exist.
- add_sale, update_sale: log or edit a sale against a purchase; the platform must already exist. update_sale never touches payout fields.
- update_shipment: tracking number, carrier or shipping status on a purchase or sale (not PAID).
- mark_sale_paid: record a payout (see above).
- add_expense, update_expense: log or edit a general expense.
- add_refund, delete_refund: a refund on a purchase (money back from the store) or a sale (money back to the buyer), instead of deleting anything; delete_refund removes one entered by mistake.
- void_sale, void_purchase: cancel a sale or purchase entered by mistake (void a purchase's sales first).
- add_note, update_note, delete_note, add_attachment: dated notes and links on a purchase or sale.
- set_market_value: a purchase's current per-unit market value.
- add_platform: a new marketplace, cashout or vendor.
- add_payment_method, update_payment_method: a card, best taken from search_card_list so its rewards stay current.
- undo_activity: reverse one Activity entry (needs confirm: true).
- Binding with a cashout -- only when the user clearly asks, and only if their key allows cashout writes: commit_cashout_deal, update_cashout_commitment, delete_cashout_commitment, submit_cashout_tracking, log_cashout_purchase (commit + tracking + record the purchase and sale, once the item has shipped).`;

const header = (version) => `PROFIT TRACKER AI GUIDE -- version ${version}`;

// Copied by "Copy full guide": everything, for an AI that has never seen it.
export function fullGuideText() {
  return [
    header(AI_GUIDE_VERSION),
    `Remember that you have read version ${AI_GUIDE_VERSION}. To catch up later, call get_ai_guide (it returns only what changed), or the user will paste just the updates.`,
    '',
    AI_GUIDE_BODY,
  ].join('\n');
}

const versionNumber = (v) => Number.parseFloat(v);

// The update notes newer than `since`, oldest first so they read in order.
// `updates` defaults to the real list; tests pass their own.
export function updatesAfter(since, updates = AI_GUIDE_UPDATES) {
  return updates
    .filter((u) => versionNumber(u.version) > versionNumber(since))
    .slice()
    .reverse();
}

// Copied by "Copy updates": only what changed after `since`, or null when the
// AI is already on the current version.
export function updatesSinceText(since, updates = AI_GUIDE_UPDATES) {
  const newer = updatesAfter(since, updates);
  if (!newer.length) return null;
  const current = updates[0].version;
  return [
    `PROFIT TRACKER AI GUIDE -- updates from version ${since} to ${current}`,
    `You already know version ${since}. These are the only changes since; apply them, then remember that you are on version ${current}.`,
    '',
    ...newer.flatMap((u) => [`${u.version} (${u.date})`, ...u.notes.map((n) => `- ${n}`), '']),
  ].join('\n').trimEnd();
}

export const wordCount = (text) => (text ? text.trim().split(/\s+/).length : 0);
