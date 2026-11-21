// The To-Do page: things that need the user's attention, worked out from their
// records on every read. Nothing here writes a record. An item goes away on its
// own once the record behind it changes (tracking added, payout marked paid,
// ...); the only thing stored is what the user did with an item -- snoozed,
// dismissed, or (a card bill) marked paid -- in TodoState, keyed by the item's
// `key`.
//
// Dates are local calendar dates (YYYY-MM-DD). `today` comes from the user's
// device (routes/todos.js), so "due in 2 days" means their days, not UTC's.
const crypto = require('node:crypto');
const { decimal } = require('./money');
const { payoutStatus } = require('./payoutStatus');
const { LEGACY_TO_RECEIVING_STATUS, legacyWorkflowStatus, allowedActions } = require('./statusTransitions');
const { computeCardDashboard } = require('./cardNetToPay');
const { REPEAT_LABEL } = require('./reminders');

// How long something may sit before it becomes a to-do, in days.
const THRESHOLDS = {
  ship: 3, // sold, not shipped or handed over
  shipOverdue: 7,
  scanIn: 5, // delivered to the cash-out, not scanned in
  payout: 7, // scanned in / accepted / waiting for payment, not paid
  purchaseTracking: 2, // purchased, no tracking number
  purchaseLookback: 60, // older purchases with no tracking or card are left alone
  preOrder: 30,
  aging: 30, // on hand and not listed
  returnWindow: 3, // days before the return-by date
  cardDueAhead: 3,
  cardOverdueShown: 5, // days after a missed due date the item stays up
  statementAhead: 3,
  payDownAhead: 5,
  payDownPct: 30,
  recurringAhead: 3,
  reminderAhead: 3, // a reminder joins the list this many days before it's due
  stale: 60, // a sale stuck this long was probably finished; offer to fix its status
  cardInUse: 90, // card setup is only asked for cards used this recently
};

const URGENCY_ORDER = { overdue: 0, today: 1, soon: 2, info: 3 };
const GROUPS = ['reminders', 'cashout', 'cards', 'sales', 'purchases', 'bookkeeping'];
const DELIVERED = 'Delivered';

// ─── Local-date helpers ──────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateStr(value) {
  if (!value) return null;
  if (typeof value === 'string' && DATE_RE.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const toUtc = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// Whole days from a to b (b later = positive).
const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);

function addDays(str, n) {
  const d = new Date(toUtc(str) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// The given day of a month, clamped to the month's length.
function dayOfMonth(year, monthIndex, day) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, last))).toISOString().slice(0, 10);
}

// The next date on or after `today` that falls on `day` of a month, and the
// last one before it.
function monthlyDates(day, today) {
  const [y, m] = today.split('-').map(Number);
  const thisMonth = dayOfMonth(y, m - 1, day);
  if (thisMonth >= today) return { next: thisMonth, previous: dayOfMonth(y, m - 2, day) };
  return { next: dayOfMonth(y, m, day), previous: thisMonth };
}

function shortDate(str) {
  return new Date(toUtc(str)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
const daysAgo = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
const usd = (value) => `$${decimal(value || 0).toFixed(2)}`;

// ─── Record readers ──────────────────────────────────────────────────────────
// A sale's step, including rows from before the status workflow existed.
function saleStatus(sale) {
  return sale.workflow_status || legacyWorkflowStatus(sale.status, sale.workflow_type) || null;
}

function purchaseStatus(inv) {
  return inv.receiving_status || LEGACY_TO_RECEIVING_STATUS[inv.status] || null;
}

const isCashoutSale = (sale) => sale.platform?.type === 'Cashout';
const productOf = (sale) => sale.inventory?.product_name || 'Item';
const saleLink = (sale) => ({ kind: 'transaction', inventoryId: sale.inventory_id, saleId: sale.id });
const purchaseLink = (inv) => ({ kind: 'transaction', inventoryId: inv.id, saleId: null });
const deliveredPerCarrier = (info) => Boolean(info && info.trackable !== false && info.status === DELIVERED);

// The sale fields the page needs to run a status action right on the item
// (the same forms as on Statuses), limited to the actions that clear it.
// `wanted` maps an action to its button label. Rows from before the status
// workflow have no stored status, so the action route would refuse them;
// those keep Open only.
function saleRecord(sale, wanted) {
  if (!sale.workflow_status) return null;
  const actions = allowedActions(sale, 'sale')
    .filter((descriptor) => descriptor.action in wanted)
    .map((descriptor) => ({ ...descriptor, secondary: false, label: wanted[descriptor.action] || descriptor.label }));
  if (!actions.length) return null;
  const num = (value) => (value == null ? 0 : decimal(value).toNumber());
  return {
    kind: 'sale',
    id: sale.id,
    quantity: sale.quantity,
    unit_price: num(sale.unit_price_decimal ?? sale.unit_price),
    commission_fee: num(sale.commission_fee_decimal ?? sale.commission_fee),
    sale_shipping: num(sale.sale_shipping_decimal ?? sale.sale_shipping),
    workflow_status: sale.workflow_status,
    workflow_type: sale.workflow_type,
    allowed_actions: actions,
  };
}

// "Lot bought Mar 3 · Costco": tells look-alike sales of the same product
// apart (they come from different purchase lots).
function lotText(inv) {
  const bought = dateStr(inv?.purchase_date);
  if (!bought) return null;
  return `Lot bought ${shortDate(bought)}${inv.vendor?.name ? ` · ${inv.vendor.name}` : ''}`;
}

function item(fields) {
  return {
    due_date: null,
    amount: null,
    link: null,
    actions: ['snooze', 'dismiss'],
    ...fields,
  };
}

// ─── Rules ───────────────────────────────────────────────────────────────────
function cashoutCommitmentItems(commitments) {
  const items = [];
  for (const c of commitments) {
    const sale = c.sale || null;
    const name = sale?.inventory?.product_name || `Deal item ${c.external_item_id}`;
    const where = c.connection?.display_name || c.connection?.platform?.name || c.connection?.provider || 'the cash-out';
    const qty = `${c.quantity}×`;
    const link = sale ? saleLink(sale) : { kind: 'page', to: '/cashout' };
    const noTracking = !(c.tracking_codes && c.tracking_codes.length) && !c.tracking_submitted_at;

    if (c.status === 'pending') {
      const hasTracking = Boolean(sale?.tracking_number);
      items.push(item({
        key: `commit-pending:${c.id}`,
        type: 'commit_pending',
        group: 'cashout',
        urgency: c.commit_error ? 'today' : 'soon',
        title: c.commit_error ? "Couldn't commit" : hasTracking ? 'Commit to the cash-out' : 'Add tracking to commit',
        detail: `${qty} ${name} · ${where}${c.commit_error ? ` · ${c.commit_error}` : ''}`,
        link,
      }));
    } else if (c.status === 'active' && !sale) {
      items.push(item({
        key: `commit-nosale:${c.id}`,
        type: 'commit_no_purchase',
        group: 'cashout',
        urgency: 'soon',
        title: 'Committed, no purchase logged',
        detail: `${qty} ${name} · ${where}`,
        link,
      }));
    } else if (c.status === 'active' && c.tracking_error) {
      items.push(item({
        key: `tracking-failed:${c.id}`,
        type: 'tracking_failed',
        group: 'cashout',
        urgency: 'today',
        title: "Tracking didn't send",
        detail: `${qty} ${name} · ${where} · ${c.tracking_error}`,
        link,
      }));
    } else if (c.status === 'active' && noTracking) {
      items.push(item({
        key: `send-tracking:${c.id}`,
        type: 'send_tracking',
        group: 'cashout',
        urgency: 'soon',
        title: 'Send tracking',
        detail: `${qty} ${name} · ${where}`,
        link,
      }));
    } else if ((c.status === 'expired' || c.status === 'closed') && noTracking) {
      items.push(item({
        key: `deal-closed:${c.id}`,
        type: 'deal_closed_unshipped',
        group: 'cashout',
        urgency: 'today',
        title: 'Deal closed before you shipped',
        detail: `${qty} ${name} · ${where} · sell, return or commit it elsewhere`,
        link,
      }));
    }
  }
  return items;
}

function connectionItems(connections) {
  return connections
    .filter((conn) => conn.status === 'attention_needed')
    .map((conn) => item({
      key: `reconnect:${conn.id}`,
      type: 'reconnect_cashout',
      group: 'cashout',
      urgency: 'today',
      title: `Reconnect ${conn.display_name || conn.platform?.name || conn.provider}`,
      detail: conn.last_error || 'The cash-out stopped accepting this connection.',
      link: { kind: 'page', to: '/cashout' },
    }));
}

function saleItems(sales, today) {
  const items = [];
  for (const sale of sales) {
    if (sale.voided_at || sale.cancelled_at) continue;
    const status = saleStatus(sale);
    const cashout = isCashoutSale(sale);
    const group = cashout ? 'cashout' : 'sales';
    const name = productOf(sale);
    const where = sale.platform?.name || (cashout ? 'the cash-out' : 'no platform');
    const since = dateStr(sale.workflow_status_changed_at) || dateStr(sale.sale_date);
    const age = since ? daysBetween(since, today) : 0;
    const qty = sale.quantity > 1 ? `${sale.quantity}× ` : '';
    const link = saleLink(sale);

    // Not shipped. A cash-out sale with a commitment is covered by the
    // commitment's own item (send tracking / add tracking to commit).
    if ((status === 'AWAITING_SHIPMENT' || status === 'AWAITING_HANDOFF') && !sale.cashout_commitment && age >= THRESHOLDS.ship) {
      const handoff = status === 'AWAITING_HANDOFF';
      // Months later it almost surely went out; offer to set the real step.
      const stale = age >= THRESHOLDS.stale;
      items.push(item({
        key: `ship:${sale.id}`,
        type: 'ship',
        group,
        urgency: age >= THRESHOLDS.shipOverdue ? 'overdue' : 'soon',
        title: handoff ? 'Hand it off' : 'Ship it',
        detail: `${qty}${name} · sold on ${where} ${daysAgo(age)}${stale ? ' · already done? Fix its status' : ''}`,
        lot: lotText(sale.inventory),
        stale,
        record: saleRecord(sale, {
          add_outbound_tracking: 'Add tracking',
          mark_handed_over: 'Handed over',
          ...(stale ? { correct_status: 'Fix status' } : {}),
        }),
        link,
      }));
    }

    if (status === 'OUTBOUND' && deliveredPerCarrier(sale.tracking_info)) {
      items.push(item({
        key: `sale-delivered:${sale.id}`,
        type: 'sale_delivered',
        group,
        urgency: 'soon',
        title: 'Delivered, update the status',
        detail: `${qty}${name} · ${where}`,
        link,
      }));
    }

    if (cashout && (status === 'DELIVERED_TO_PROVIDER' || status === 'WAITING_FOR_SCAN_IN') && age >= THRESHOLDS.scanIn) {
      items.push(item({
        key: `scan-in:${sale.id}`,
        type: 'not_scanned_in',
        group,
        urgency: 'soon',
        title: 'Not scanned in yet',
        detail: `${qty}${name} · at ${where} for ${age} days`,
        lot: lotText(sale.inventory),
        record: saleRecord(sale, { mark_scanned_in: 'Scanned in' }),
        link,
      }));
    }

    // Payout late: past the expected payout date, past this buyer's usual
    // payout time, or simply waiting a week.
    const paid = payoutStatus(sale);
    if (paid === 'unpaid' && ['WAITING_FOR_PAYMENT', 'SCANNED_IN', 'ACCEPTED', 'HANDED_OVER'].includes(status)) {
      const payoutDate = dateStr(sale.payout_date);
      const avgDays = sale.buyer?.avg_days_to_payout;
      const saleDay = dateStr(sale.sale_date);
      const expected = payoutDate || (avgDays && saleDay ? addDays(saleDay, avgDays) : null);
      const late = expected ? expected < today : age >= THRESHOLDS.payout;
      if (late) {
        items.push(item({
          key: `payout:${sale.id}`,
          type: 'payout_late',
          group,
          urgency: expected ? 'overdue' : 'soon',
          title: cashout ? 'Cash-out payment late' : 'Payout late',
          detail: `${qty}${name} · ${where} · ${expected ? `expected ${shortDate(expected)}` : `no change in ${age} days`}${saleDay ? ` · sold ${shortDate(saleDay)}` : ''}`,
          due_date: expected,
          amount: decimal(sale.unit_price || 0).times(sale.quantity || 0).toDecimalPlaces(2).toNumber(),
          lot: lotText(sale.inventory),
          record: saleRecord(sale, { mark_paid: 'Mark paid' }),
          link,
        }));
      }
    }

    if (paid === 'partial') {
      items.push(item({
        key: `short-paid:${sale.id}`,
        type: 'short_paid',
        group,
        urgency: 'soon',
        title: `Short-paid ${usd(sale.payout_short_amount)}`,
        detail: `${qty}${name} · ${where}`,
        amount: decimal(sale.payout_short_amount).toDecimalPlaces(2).toNumber(),
        link,
      }));
    }

    if (status === 'RETURN_IN_PROGRESS') {
      items.push(item({
        key: `return:${sale.id}`,
        type: 'open_return',
        group,
        urgency: 'soon',
        title: 'Open return',
        detail: `${qty}${name} · ${where}`,
        link,
      }));
    }

    if (status === 'DISPUTED') {
      items.push(item({
        key: `dispute:${sale.id}`,
        type: 'open_dispute',
        group,
        urgency: 'today',
        title: 'Open dispute',
        detail: `${qty}${name} · ${where}`,
        link,
      }));
    }
  }
  return items;
}

function purchaseItems(inventories, today) {
  const items = [];
  for (const inv of inventories) {
    if (inv.cancelled_at) continue;
    const status = purchaseStatus(inv);
    const bought = dateStr(inv.purchase_date);
    const age = bought ? daysBetween(bought, today) : 0;
    const onHand = (inv.qty_on_hand || 0) > 0;
    const qty = inv.qty_on_hand > 1 ? `${inv.qty_on_hand}× ` : '';
    const name = inv.product_name;
    const store = inv.vendor?.name ? ` · ${inv.vendor.name}` : '';
    const link = purchaseLink(inv);
    const recent = age <= THRESHOLDS.purchaseLookback;

    if (onHand && (status === 'PURCHASED' || status === 'INBOUND') && deliveredPerCarrier(inv.tracking_info)) {
      items.push(item({
        key: `received:${inv.id}`, type: 'mark_received', group: 'purchases', urgency: 'soon',
        title: 'Delivered, mark it received', detail: `${qty}${name}${store}`, link,
      }));
    } else if (onHand && recent && (status === 'PURCHASED' || status === 'INBOUND') && !inv.tracking_number && age >= THRESHOLDS.purchaseTracking) {
      items.push(item({
        key: `purchase-tracking:${inv.id}`, type: 'purchase_tracking', group: 'purchases', urgency: 'info',
        title: 'Add tracking', detail: `${qty}${name}${store} · bought ${daysAgo(age)}`, link,
      }));
    }

    if (status === 'PRE_ORDER' && age >= THRESHOLDS.preOrder) {
      items.push(item({
        key: `pre-order:${inv.id}`, type: 'pre_order', group: 'purchases', urgency: 'info',
        title: 'Pre-order check', detail: `${name}${store} · ordered ${age} days ago`, link,
      }));
    }

    const returnBy = dateStr(inv.return_by_date);
    if (onHand && returnBy) {
      const left = daysBetween(today, returnBy);
      if (left >= 0 && left <= THRESHOLDS.returnWindow) {
        items.push(item({
          key: `return-window:${inv.id}:${returnBy}`, type: 'return_window', group: 'purchases',
          urgency: left <= 1 ? 'today' : 'soon',
          title: `Return window closes ${inDays(left)}`,
          detail: `${inv.qty_on_hand} unsold · ${name}${store}`,
          due_date: returnBy, link,
        }));
      }
    }

    if (onHand && status === 'ON_HAND' && !inv.is_listed) {
      const since = dateStr(inv.received_date) || dateStr(inv.received_at) || bought;
      const held = since ? daysBetween(since, today) : 0;
      if (held >= THRESHOLDS.aging) {
        const unitCost = inv.unit_purchase_cost_decimal ?? inv.unit_purchase_cost ?? 0;
        items.push(item({
          key: `aging:${inv.id}`, type: 'aging_stock', group: 'purchases', urgency: 'info',
          title: `Sitting ${held} days, not listed`, detail: `${qty}${name}`,
          amount: decimal(unitCost).times(inv.qty_on_hand).toDecimalPlaces(2).toNumber(),
          actions: ['hold', 'snooze', 'dismiss'],
          link,
        }));
      }
    }

    if (!inv.payment_method_id && recent) {
      items.push(item({
        key: `missing-card:${inv.id}`, type: 'missing_card', group: 'cards', urgency: 'info',
        title: 'Purchase missing its card', detail: `${name}${store} · bought ${daysAgo(age)}`, link,
      }));
    }
  }
  return items;
}

// One item for every card that's missing its bill dates, and only cards used
// for a purchase lately: a card sitting in a drawer shouldn't nag. The key
// changes with the set of cards, so dismissing it doesn't hide a card that
// joins later.
function cardSetupItem(cards, inventories, today) {
  const since = addDays(today, -THRESHOLDS.cardInUse);
  const used = new Set(inventories
    .filter((inv) => inv.payment_method_id && (dateStr(inv.purchase_date) || '') >= since)
    .map((inv) => inv.payment_method_id));
  const unfinished = cards
    .filter((card) => card.type === 'Credit' && used.has(card.id) && (!card.due_day || !card.statement_close_day))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!unfinished.length) return [];
  const ids = unfinished.map((card) => card.id).sort().join(',');
  const hash = crypto.createHash('sha1').update(ids).digest('hex').slice(0, 12);
  const names = unfinished.map((card) => card.name);
  const listed = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  return [item({
    key: `card-setup:${hash}`, type: 'card_setup', group: 'cards', urgency: 'info',
    title: unfinished.length === 1 ? `Finish card setup: ${names[0]}` : `Finish setup on ${unfinished.length} cards`,
    detail: `${listed} · add the due day and statement close day so bill reminders work`,
    link: { kind: 'page', to: '/settings', state: { tab: 'datasetup', view: 'Payment Methods' } },
  })];
}

function cardItems(cards, today, spendByCard) {
  const items = [];
  for (const card of cards) {
    if (card.type !== 'Credit') continue;
    const label = card.last4 ? `${card.name} ••${card.last4}` : card.name;
    const link = { kind: 'page', to: '/creditcard' };

    if (card.due_day) {
      const { next, previous } = monthlyDates(card.due_day, today);
      const ahead = daysBetween(today, next);
      const behind = daysBetween(previous, today);
      if (ahead <= THRESHOLDS.cardDueAhead) {
        items.push(item({
          key: `card-due:${card.id}:${next}`, type: 'card_due', group: 'cards',
          urgency: ahead <= 1 ? 'today' : 'soon',
          title: `Pay ${label}`, detail: `Due ${inDays(ahead)} · ${shortDate(next)}`,
          due_date: next, link, actions: ['mark_paid', 'snooze', 'dismiss'],
        }));
      } else if (behind <= THRESHOLDS.cardOverdueShown) {
        // Shown alongside: the card was due a few days ago and was never
        // marked paid for that cycle. Marking it paid clears it for good.
        items.push(item({
          key: `card-due:${card.id}:${previous}`, type: 'card_overdue', group: 'cards', urgency: 'overdue',
          title: `${label} was due ${daysAgo(behind)}`, detail: `Due ${shortDate(previous)} · mark it paid if you already paid it`,
          due_date: previous, link, actions: ['mark_paid', 'snooze', 'dismiss'],
        }));
      }
    }

    if (card.statement_close_day) {
      const { next } = monthlyDates(card.statement_close_day, today);
      const ahead = daysBetween(today, next);
      const spend = spendByCard.get(card.id);
      const limit = Number(card.credit_limit) || 0;
      const pct = limit > 0 && spend > 0 ? (spend / limit) * 100 : 0;
      if (ahead <= THRESHOLDS.payDownAhead && pct > THRESHOLDS.payDownPct) {
        items.push(item({
          key: `card-paydown:${card.id}:${next}`, type: 'card_pay_down', group: 'cards', urgency: 'soon',
          title: `Pay down ${label} before the statement`,
          detail: `${Math.round(pct)}% of the limit in tracked spend · closes ${inDays(ahead)}`,
          due_date: next, link,
        }));
      } else if (ahead <= THRESHOLDS.statementAhead) {
        items.push(item({
          key: `card-close:${card.id}:${next}`, type: 'statement_closes', group: 'cards', urgency: 'info',
          title: `${label} statement closes ${inDays(ahead)}`, detail: shortDate(next),
          due_date: next, link,
        }));
      }
    }
  }
  return items;
}

// The first occurrence of a recurring expense on or after `today`, or null.
function nextRecurringDate(rec, today) {
  const start = dateStr(rec.start_date);
  if (!start) return null;
  const end = dateStr(rec.end_date);
  let cursor = start;
  const anchor = Number(start.slice(8, 10));
  for (let guard = 0; guard < 1000 && cursor < today; guard += 1) {
    if (rec.frequency === 'weekly') cursor = addDays(cursor, 7);
    else if (rec.frequency === 'biweekly') cursor = addDays(cursor, 14);
    else {
      const [y, m] = cursor.split('-').map(Number);
      cursor = dayOfMonth(y, m, anchor);
    }
  }
  if (cursor < today || (end && cursor > end)) return null;
  return cursor;
}

function recurringItems(recurring, today) {
  const items = [];
  for (const rec of recurring) {
    if (!rec.active) continue;
    const next = nextRecurringDate(rec, today);
    if (!next) continue;
    const ahead = daysBetween(today, next);
    if (ahead > THRESHOLDS.recurringAhead) continue;
    items.push(item({
      key: `recurring:${rec.id}:${next}`, type: 'recurring_expense', group: 'bookkeeping', urgency: 'info',
      title: `Coming up: ${rec.name}`, detail: `${usd(rec.amount_decimal ?? rec.amount)} ${inDays(ahead)} · ${shortDate(next)}`,
      due_date: next, amount: decimal(rec.amount_decimal ?? rec.amount).toDecimalPlaces(2).toNumber(),
      link: { kind: 'page', to: '/expenses' }, actions: ['dismiss'],
    }));
  }
  return items;
}

// "3:30 PM" from "15:30".
function clockTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function reminderItems(reminders, today) {
  const items = [];
  for (const rem of reminders) {
    if (rem.done_at || !rem.due_date) continue;
    const ahead = daysBetween(today, rem.due_date);
    if (ahead > THRESHOLDS.reminderAhead) continue;
    const when = ahead < 0 ? `Was due ${daysAgo(-ahead)}` : `Due ${inDays(ahead)}`;
    const card = rem.payment_method ? (rem.payment_method.last4 ? `${rem.payment_method.name} ••${rem.payment_method.last4}` : rem.payment_method.name) : null;
    const detail = [
      `${when}${rem.due_time ? ` at ${clockTime(rem.due_time)}` : ''}`,
      REPEAT_LABEL[rem.repeat],
      card,
      rem.notes,
    ].filter(Boolean).join(' · ');
    items.push(item({
      key: `reminder:${rem.id}:${rem.due_date}`,
      type: 'reminder',
      group: 'reminders',
      urgency: ahead < 0 ? 'overdue' : ahead === 0 ? 'today' : 'soon',
      title: rem.title,
      detail,
      due_date: rem.due_date,
      link: card ? { kind: 'page', to: '/creditcard' } : null,
      actions: ['complete', 'snooze', 'edit'],
      reminder: {
        id: rem.id, title: rem.title, notes: rem.notes, due_date: rem.due_date, due_time: rem.due_time,
        repeat: rem.repeat, payment_method_id: rem.payment_method_id,
      },
    }));
  }
  return items;
}

// ─── Putting it together ─────────────────────────────────────────────────────
function buildTodos(data, today) {
  const items = [
    ...cashoutCommitmentItems(data.commitments || []),
    ...connectionItems(data.connections || []),
    ...saleItems(data.sales || [], today),
    ...purchaseItems(data.inventories || [], today),
    ...cardSetupItem(data.cards || [], data.inventories || [], today),
    ...cardItems(data.cards || [], today, data.spendByCard || new Map()),
    ...recurringItems(data.recurring || [], today),
    ...reminderItems(data.reminders || [], today),
  ];
  return items.sort((a, b) =>
    URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
    || (a.due_date || '9999').localeCompare(b.due_date || '9999')
    || (b.amount || 0) - (a.amount || 0)
    || a.title.localeCompare(b.title));
}

// Hidden: dismissed, done, or snoozed until a day after today.
function isHidden(state, today) {
  if (!state) return false;
  if (state.state === 'snoozed') return Boolean(state.until && state.until > today);
  return state.state === 'dismissed' || state.state === 'done';
}

async function loadTodoData(prisma, userId, today) {
  const lookback = new Date(toUtc(addDays(today, -365)));
  const [commitments, connections, sales, inventories, cards, recurring, reminders] = await Promise.all([
    prisma.cashoutCommitment.findMany({
      where: { user_id: userId, status: { in: ['pending', 'active', 'expired', 'closed'] } },
      include: {
        connection: { include: { platform: true } },
        sale: { include: { inventory: true } },
      },
    }),
    prisma.cashoutConnection.findMany({ where: { user_id: userId }, include: { platform: true } }),
    prisma.sales.findMany({
      where: { inventory: { user_id: userId }, sale_date: { gte: lookback } },
      include: { inventory: { include: { vendor: true } }, platform: true, buyer: true, cashout_commitment: true },
    }),
    prisma.inventory.findMany({
      where: { user_id: userId, OR: [{ qty_on_hand: { gt: 0 } }, { purchase_date: { gte: lookback } }] },
      include: { vendor: true },
    }),
    prisma.paymentMethod.findMany({ where: { user_id: userId, type: 'Credit' } }),
    prisma.recurringExpense.findMany({ where: { user_id: userId, active: true } }),
    prisma.reminder.findMany({
      where: { user_id: userId, done_at: null, due_date: { lte: addDays(today, THRESHOLDS.reminderAhead) } },
      include: { payment_method: { select: { name: true, last4: true } } },
    }),
  ]);

  // Tracked spend this month, only needed when a card's statement is close.
  const spendByCard = new Map();
  const needsSpend = cards.some((card) => card.credit_limit && card.statement_close_day
    && daysBetween(today, monthlyDates(card.statement_close_day, today).next) <= THRESHOLDS.payDownAhead);
  if (needsSpend) {
    const dashboard = await computeCardDashboard(prisma, userId, today.slice(0, 7));
    for (const card of dashboard.cards) spendByCard.set(card.id, card.totalSpend);
  }

  return { commitments, connections, sales, inventories, cards, recurring, reminders, spendByCard };
}

async function listTodos(prisma, userId, today) {
  const [data, states] = await Promise.all([
    loadTodoData(prisma, userId, today),
    prisma.todoState.findMany({ where: { user_id: userId } }),
  ]);
  const byKey = new Map(states.map((s) => [s.key, s]));
  const all = buildTodos(data, today);
  const items = [];
  const hiddenItems = [];
  for (const entry of all) {
    const state = byKey.get(entry.key);
    if (isHidden(state, today)) hiddenItems.push({ ...entry, state: state.state, until: state.until });
    else items.push(entry);
  }
  const counts = { total: items.length, urgent: items.filter((entry) => entry.urgency === 'overdue' || entry.urgency === 'today').length };
  for (const group of GROUPS) counts[group] = items.filter((entry) => entry.group === group).length;
  // Hidden items still in play (the record still needs it), so the page can
  // offer "Bring back". A card bill marked paid is done, not listed.
  return { today, items, counts, hidden: hiddenItems.length, hidden_items: hiddenItems.filter((entry) => entry.state !== 'done') };
}

module.exports = {
  THRESHOLDS,
  GROUPS,
  buildTodos,
  listTodos,
  isHidden,
  // exported for tests
  monthlyDates,
  nextRecurringDate,
  daysBetween,
};
