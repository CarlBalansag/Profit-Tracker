// Cashout deal alerts: tell users when a cashout drops a new deal, with what
// they'd make on it using their best card.
//
//   1. recordDealsSeen(provider, deals) runs after every successful deal fetch
//      (service.js fetchConnectionDeals), from any user's connection. Deals are
//      the same for everyone, so they're kept once per provider deal in
//      CashoutDeal. A deal never seen before, one back after a day away, or one
//      whose payout rose $5+ since its last alert gets a CashoutDealAlert row.
//      The first fetch ever of a provider only fills the list (no alerts), so
//      connecting a cashout doesn't announce every deal it already has.
//   2. dispatchDealAlerts() runs after the scheduled cashout sync and on every
//      notification run. It pushes each new alert to every user who turned
//      deal alerts on, if the deal passes their filters (minimum profit / ROI,
//      cashouts, stores, quiet hours). Several at once go out as one push.
//   3. listDealFeed(userId) is the Cashout page's New deals list.
//
// Profit = payout - retail + the best card's rewards on retail (no sales tax).
// ROI = that profit / retail.
const prisma = require('../../prisma');
const { effectiveCashbackRate } = require('../decimalFinance');
const { getAdapter } = require('./registry');
const { sendToUser, pushConfig } = require('../push');
const { localNow, DEFAULTS } = require('../notificationRun');

const RELIST_AFTER_MS = 24 * 60 * 60 * 1000;
const PAYOUT_RISE_MIN = 5;
// An alert the sender didn't get to in this long (cron down, push off) is
// stale: it stays in the feed but is never pushed.
const PUSH_WITHIN_MS = 2 * 60 * 60 * 1000;
const KEEP_ALERTS_DAYS = 14;
const FORGET_DEALS_DAYS = 30;
const FEED_DAYS = 7;

const DEAL_DEFAULTS = {
  deal_alerts: false, deal_min_profit: 0, deal_min_roi: null, deal_providers: null, deal_stores: null, deal_quiet_from: null, deal_quiet_to: null,
};

const num = (value) => (value === null || value === undefined || value === '' ? null : Number(value));
const cents = (value) => Math.round(value * 100) / 100;
const storeKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function providerName(provider) {
  try {
    const adapter = getAdapter(provider);
    return adapter.settingsName || adapter.name || provider.toUpperCase();
  } catch {
    return String(provider || '').toUpperCase();
  }
}

// The stores a deal can be bought at, once each (same rule as the Cashout
// page: one entry per store name, ignoring case and punctuation).
function dealStoreNames(deal) {
  const items = Array.isArray(deal?.items) ? deal.items : [];
  const links = [
    ...items.flatMap((item) => (Array.isArray(item?.purchaseLinks) ? item.purchaseLinks : [])),
    ...(Array.isArray(deal?.productLinks) ? deal.productLinks : []),
  ];
  const seen = new Set();
  const names = [];
  for (const link of links) {
    const name = typeof link?.name === 'string' ? link.name.trim() : '';
    const key = storeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name.slice(0, 80));
  }
  return names.slice(0, 20);
}

function vendorLimit(deal) {
  const limits = (Array.isArray(deal?.items) ? deal.items : [])
    .map((item) => Number(item?.vendorLimit))
    .filter((value) => Number.isInteger(value) && value > 0);
  return limits.length ? Math.max(...limits) : null;
}

const isLive = (deal) => deal && deal.id !== undefined && deal.id !== null && (deal.status || 'active') === 'active' && Number(deal.payout) > 0;

function dealFields(deal, now) {
  const retail = num(deal.retail);
  const expires = deal.expiresAt ? new Date(deal.expiresAt) : null;
  return {
    name: String(deal.name || 'Untitled deal').slice(0, 300),
    image_url: typeof deal.imageUrl === 'string' ? deal.imageUrl.slice(0, 1000) : null,
    deal_url: typeof deal.dealUrl === 'string' ? deal.dealUrl.slice(0, 1000) : null,
    retail: retail !== null && retail > 0 ? cents(retail) : null,
    payout: cents(Number(deal.payout)),
    stores: dealStoreNames(deal),
    vendor_limit: vendorLimit(deal),
    expires_at: expires && Number.isFinite(expires.getTime()) ? expires : null,
    last_seen_at: now,
  };
}

const isUniqueError = (err) => err?.code === 'P2002' || /Unique constraint/i.test(err?.message || '');

// Records one provider's current deals and creates alerts for what's new.
// Returns how many alerts it created. Safe to run from two syncs at once: the
// unique key and the conditional updates make only one of them win.
// keepKnown (the Discord reader, whose posts have no store names or picture):
// an empty value never replaces one the daily check saved.
async function recordDealsSeen(provider, deals, { now = new Date(), keepKnown = false } = {}) {
  const live = (Array.isArray(deals) ? deals : []).filter(isLive);
  const seeding = (await prisma.cashoutDeal.count({ where: { provider } })) === 0;
  if (!live.length) return { created: 0, seeding };

  const ids = [...new Set(live.map((deal) => String(deal.id)))];
  const existing = await prisma.cashoutDeal.findMany({ where: { provider, external_deal_id: { in: ids } } });
  const byId = new Map(existing.map((row) => [row.external_deal_id, row]));
  let created = 0;
  const done = new Set();

  for (const deal of live) {
    const externalId = String(deal.id);
    if (done.has(externalId)) continue;
    done.add(externalId);
    const row = byId.get(externalId);
    const fields = dealFields(deal, now);
    if (keepKnown && row) {
      if (!fields.stores.length && Array.isArray(row.stores) && row.stores.length) fields.stores = row.stores;
      if (!fields.image_url && row.image_url) fields.image_url = row.image_url;
      if (fields.retail === null && row.retail !== null) fields.retail = num(row.retail);
      if (fields.vendor_limit === null && row.vendor_limit !== null) fields.vendor_limit = row.vendor_limit;
      if (!fields.expires_at && row.expires_at) fields.expires_at = row.expires_at;
    }

    if (!row) {
      try {
        await prisma.cashoutDeal.create({
          data: {
            provider,
            external_deal_id: externalId,
            ...fields,
            first_seen_at: now,
            alerted_payout: fields.payout,
            ...(seeding ? {} : { alerts: { create: { kind: 'new', payout: fields.payout, retail: fields.retail, created_at: now } } }),
          },
        });
        if (!seeding) created += 1;
      } catch (err) {
        if (!isUniqueError(err)) throw err;
        // Another sync added it a moment ago; it made the alert.
      }
      continue;
    }

    const away = now.getTime() - new Date(row.last_seen_at).getTime() > RELIST_AFTER_MS;
    const alerted = num(row.alerted_payout) ?? num(row.payout);
    const rose = fields.payout >= alerted + PAYOUT_RISE_MIN;

    if (away || rose) {
      // Only the sync that still sees the old values gets to alert.
      const { count } = await prisma.cashoutDeal.updateMany({
        where: { id: row.id, last_seen_at: row.last_seen_at, alerted_payout: row.alerted_payout },
        data: { ...fields, alerted_payout: fields.payout },
      });
      if (count === 1) {
        await prisma.cashoutDealAlert.create({
          data: {
            deal_id: row.id,
            kind: away ? 'relisted' : 'payout_up',
            payout: fields.payout,
            previous_payout: away ? null : alerted,
            retail: fields.retail,
            created_at: now,
          },
        });
        created += 1;
      }
    } else {
      await prisma.cashoutDeal.update({ where: { id: row.id }, data: fields });
    }
  }
  return { created, seeding };
}

// What a user makes on a deal with their best card: each card at each of the
// deal's stores (a store rate beats the base rate, expired store rates don't
// count), highest wins. Same lookup a logged purchase uses.
function evaluateDeal({ payout, retail, stores }, cards, today = new Date()) {
  const payoutValue = num(payout) ?? 0;
  const retailValue = num(retail);
  const names = Array.isArray(stores) && stores.length ? stores : [null];
  let best = null;
  for (const card of Array.isArray(cards) ? cards : []) {
    for (const store of names) {
      const rate = effectiveCashbackRate({ payment_method: card, vendor: store ? { name: store } : null }, today);
      if (rate > 0 && (!best || rate > best.rate)) best = { card: { id: card.id, name: card.name }, store, rate };
    }
  }
  const spread = retailValue && retailValue > 0 ? cents(payoutValue - retailValue) : null;
  const rewards = best && retailValue && retailValue > 0 ? cents((retailValue * best.rate) / 100) : null;
  const profit = spread === null ? null : cents(spread + (rewards || 0));
  return {
    payout: payoutValue,
    retail: retailValue,
    spread,
    rewards,
    profit,
    roi: profit !== null ? cents((profit / retailValue) * 100) : null,
    best_card: best,
  };
}

function dealSettings(row) {
  const merged = { ...DEFAULTS, ...DEAL_DEFAULTS, ...(row || {}) };
  const list = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : []);
  return {
    ...merged,
    deal_min_profit: num(merged.deal_min_profit) ?? 0,
    deal_min_roi: num(merged.deal_min_roi),
    deal_providers: list(merged.deal_providers),
    deal_stores: list(merged.deal_stores),
  };
}

function inQuietHours(settings, now) {
  const from = settings.deal_quiet_from;
  const to = settings.deal_quiet_to;
  if (!from || !to || from === to) return false;
  const { time } = localNow(now, settings.timezone);
  return from < to ? time >= from && time < to : time >= from || time < to;
}

// Whether a deal is one this user asked to hear about. A deal with no retail
// price has no profit or ROI to check, so it passes only a $0 minimum and no
// ROI minimum above 0%.
function passesFilters(deal, evaluation, settings) {
  if (settings.deal_providers.length && !settings.deal_providers.includes(deal.provider)) return false;
  if (settings.deal_stores.length) {
    const wanted = settings.deal_stores.map(storeKey).filter(Boolean);
    const stores = (Array.isArray(deal.stores) ? deal.stores : []).map(storeKey);
    if (!stores.some((store) => wanted.some((want) => store.includes(want) || want.includes(store)))) return false;
  }
  const minRoi = settings.deal_min_roi ?? null;
  if (evaluation.profit === null) return settings.deal_min_profit <= 0 && (minRoi === null || minRoi <= 0);
  if (evaluation.profit < settings.deal_min_profit) return false;
  return minRoi === null || (evaluation.roi ?? (evaluation.profit / evaluation.retail) * 100) >= minRoi;
}

const money = (value) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })}`;
const signed = (value) => `${value < 0 ? '-' : '+'}${money(Math.abs(value))}`;
// ROI: profit over what goes in (retail; no sales tax, same as the profit),
// one decimal: "+16.4% ROI". Nothing without a retail price.
function roiLabel(evaluation) {
  const retail = num(evaluation?.retail);
  if (evaluation?.profit === null || evaluation?.profit === undefined || !(retail > 0)) return null;
  const pct = Math.round((Number(evaluation.profit) / retail) * 1000) / 10;
  if (!Number.isFinite(pct)) return null;
  return `${pct > 0 ? '+' : pct < 0 ? '-' : ''}${Math.abs(pct)}% ROI`;
}
const withRoi = (evaluation) => {
  const roi = roiLabel(evaluation);
  return roi ? ` (${roi})` : '';
};
const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Short cashout labels for notifications: "EB", "LA", "P4D".
const shortProvider = (provider) => String(provider || '').toUpperCase();

// A card's name without the boilerplate: "Blue Business Plus Credit Card from
// American Express" -> "Blue Business Plus".
function shortCard(name) {
  const short = String(name || '')
    .replace(/\s+from\s+.+$/i, '')
    .replace(/\b(credit|debit)\s+card\b/ig, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return short || String(name || '').trim();
}

// "Cashout $52, $49 at Walmart -> +$3.98 (+8.1% ROI) Blue Business Plus"
function alertLine(alert, evaluation) {
  const deal = alert.deal;
  let line = `Cashout ${money(evaluation.payout)}`;
  if (alert.kind === 'payout_up' && alert.previous_payout !== null && alert.previous_payout !== undefined) {
    line += ` (was ${money(num(alert.previous_payout))})`;
  }
  if (evaluation.retail) {
    const store = evaluation.best_card?.store || (Array.isArray(deal.stores) && deal.stores[0]) || null;
    line += `, ${money(evaluation.retail)}${store ? ` at ${store}` : ''}`;
  } else {
    line += ', no retail price';
  }
  if (evaluation.profit !== null) {
    line += ` -> ${signed(evaluation.profit)}${withRoi(evaluation)}`;
    if (evaluation.best_card && evaluation.rewards) line += ` ${shortCard(evaluation.best_card.card.name)}`;
  }
  return line;
}

// "EB: Pencil USB-C", with "(payout up)" or "(back)" when it isn't new.
function alertTitle(alert) {
  const note = alert.kind === 'payout_up' ? ' (payout up)' : alert.kind === 'relisted' ? ' (back)' : '';
  return shorten(`${shortProvider(alert.deal.provider)}: ${alert.deal.name}`, 80 - note.length) + note;
}

function buildPayload(matches) {
  if (matches.length === 1) {
    const [{ alert, evaluation }] = matches;
    return { title: alertTitle(alert), body: alertLine(alert, evaluation), url: `/cashout?tab=new-deals&alert=${alert.id}`, tag: `deal-${alert.id}` };
  }
  // Several at once: one line each, best profit first.
  const ranked = [...matches].sort((a, b) => (b.evaluation.profit ?? -Infinity) - (a.evaluation.profit ?? -Infinity));
  const lines = ranked.slice(0, 4).map(({ alert, evaluation }) => (
    `${shortProvider(alert.deal.provider)}: ${shorten(alert.deal.name, 32)}${evaluation.profit !== null ? ` ${signed(evaluation.profit)}${withRoi(evaluation)}` : ''}`
  ));
  if (ranked.length > 4) lines.push(`+${ranked.length - 4} more`);
  return {
    title: `${matches.length} new cashout deals`,
    body: lines.join('\n'),
    url: '/cashout?tab=new-deals',
    tag: 'deals',
  };
}

async function claim(userId, key) {
  try {
    await prisma.notificationSent.create({ data: { user_id: userId, key } });
    return true;
  } catch (err) {
    if (isUniqueError(err)) return false;
    throw err;
  }
}

// Pushes every alert not sent yet. Returns counts.
async function dispatchDealAlerts({ now = new Date() } = {}) {
  const pending = await prisma.cashoutDealAlert.findMany({
    where: { dispatched_at: null },
    include: { deal: true },
    orderBy: { created_at: 'asc' },
    take: 200,
  });
  const cutoff = now.getTime() - PUSH_WITHIN_MS;
  const stale = pending.filter((alert) => new Date(alert.created_at).getTime() < cutoff);
  const fresh = pending.filter((alert) => new Date(alert.created_at).getTime() >= cutoff);
  const summary = { alerts: fresh.length, stale: stale.length, users: 0, sent: 0, disabled: false };

  if (stale.length) {
    await prisma.cashoutDealAlert.updateMany({ where: { id: { in: stale.map((alert) => alert.id) }, dispatched_at: null }, data: { dispatched_at: now } });
  }
  if (!fresh.length) {
    await prune(now);
    return summary;
  }
  if (!pushConfig().enabled) {
    // Nothing can be sent; they stay pending until push is set up, then go stale.
    summary.disabled = true;
    return summary;
  }

  const subscribers = await prisma.notificationSettings.findMany({ where: { deal_alerts: true, user: { push_subscriptions: { some: {} } } } });
  summary.users = subscribers.length;

  for (const row of subscribers) {
    try {
      const settings = dealSettings(row);
      if (inQuietHours(settings, now)) continue;
      const cards = await prisma.paymentMethod.findMany({ where: { user_id: row.user_id } });
      const matches = [];
      for (const alert of fresh) {
        const evaluation = evaluateDeal({ payout: alert.payout, retail: alert.retail, stores: alert.deal.stores }, cards, now);
        if (!passesFilters(alert.deal, evaluation, settings)) continue;
        if (await claim(row.user_id, `deal:${alert.id}`)) matches.push({ alert, evaluation });
      }
      if (!matches.length) continue;
      const result = await sendToUser(row.user_id, buildPayload(matches));
      if (result.sent > 0) summary.sent += 1;
    } catch (err) {
      console.error(`[deal-alerts] send failed for user ${row.user_id}:`, err.message);
    }
  }

  await prisma.cashoutDealAlert.updateMany({ where: { id: { in: fresh.map((alert) => alert.id) }, dispatched_at: null }, data: { dispatched_at: now } });
  await prune(now);
  return summary;
}

async function prune(now) {
  await prisma.cashoutDealAlert.deleteMany({ where: { created_at: { lt: new Date(now.getTime() - KEEP_ALERTS_DAYS * 86400000) } } });
  await prisma.cashoutDeal.deleteMany({
    where: { last_seen_at: { lt: new Date(now.getTime() - FORGET_DEALS_DAYS * 86400000) }, alerts: { none: {} } },
  });
}

// The Cashout page's New deals list: the last week of alerts, newest first,
// each with this user's profit and best card and whether it passes their
// alert filters. `live` says whether the deal was still listed in the last
// hour of syncs.
async function listDealFeed(userId, { now = new Date(), limit = 60 } = {}) {
  const [alerts, cards, row] = await Promise.all([
    prisma.cashoutDealAlert.findMany({
      where: { created_at: { gte: new Date(now.getTime() - FEED_DAYS * 86400000) } },
      include: { deal: true },
      orderBy: { created_at: 'desc' },
      take: Math.min(Math.max(Number(limit) || 60, 1), 200),
    }),
    prisma.paymentMethod.findMany({ where: { user_id: userId } }),
    prisma.notificationSettings.findUnique({ where: { user_id: userId } }),
  ]);
  const settings = dealSettings(row);
  return {
    alerts_on: settings.deal_alerts,
    items: alerts.map((alert) => {
      const deal = alert.deal;
      // Today's numbers for the profit; the alert's own for what it said.
      const evaluation = evaluateDeal({ payout: deal.payout, retail: deal.retail, stores: deal.stores }, cards, now);
      return {
        id: alert.id,
        kind: alert.kind,
        created_at: alert.created_at,
        alert_payout: num(alert.payout),
        previous_payout: num(alert.previous_payout),
        deal: {
          id: deal.id,
          provider: deal.provider,
          provider_name: providerName(deal.provider),
          external_deal_id: deal.external_deal_id,
          name: deal.name,
          image_url: deal.image_url,
          deal_url: deal.deal_url,
          stores: Array.isArray(deal.stores) ? deal.stores : [],
          vendor_limit: deal.vendor_limit,
          expires_at: deal.expires_at,
          live: now.getTime() - new Date(deal.last_seen_at).getTime() < 60 * 60 * 1000,
        },
        ...evaluation,
        matches_filters: passesFilters(deal, evaluation, settings),
      };
    }),
  };
}

// When Profit Tracker first saw each of a cashout's deals, for "Recently
// Added" on the Cashout page (only EB says when it posted a deal).
// Returns Map(external deal id -> ISO date).
async function firstSeenDates(provider, ids) {
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return new Map();
  const rows = await prisma.cashoutDeal.findMany({
    where: { provider, external_deal_id: { in: list } },
    select: { external_deal_id: true, first_seen_at: true },
  });
  return new Map(rows.map((row) => [row.external_deal_id, new Date(row.first_seen_at).toISOString()]));
}

module.exports = {
  recordDealsSeen,
  firstSeenDates,
  dispatchDealAlerts,
  listDealFeed,
  evaluateDeal,
  passesFilters,
  dealSettings,
  dealStoreNames,
  inQuietHours,
  buildPayload,
  roiLabel,
  shortCard,
  DEAL_DEFAULTS,
  PAYOUT_RISE_MIN,
};
