// New LA and Points4Days deals from their Discord announcement channels, so
// deal alerts for them don't wait for the once-a-day check (signing in to their
// websites more often got a warning).
//
// The user follows each cashout's deals channel (e.g. #above-cost-deals) into a
// channel of their own Discord server, and adds our bot to that server. Every
// scheduled sync (syncScheduler.js, once a minute) reads the new posts there
// through Discord's API. Nothing here touches the cashouts' websites.
//
// A post links to the deal on the cashout's site. That link carries the deal's
// own ID (base64 JSON {"vq": ROT13 of the ID}), so a post is the same deal the
// daily check lists: it alerts once, and the daily check later fills in what a
// post doesn't have (store links, UPCs, the deal's items) by replacing the list.
//
//   DISCORD_BOT_TOKEN       the bot's token (Bot tab in Discord's developer portal)
//   DISCORD_DEAL_CHANNELS   comma-separated IDs of the channels in your server
//                           the cashouts' deals channels are followed into
//
// Which cashout a post is from comes from its deal link, so one channel can
// carry both. A post this can't read is skipped, never half-saved.
const prisma = require('../../prisma');
const { recordDealsSeen } = require('./dealAlerts');
const { dealsCache } = require('./service');

const API = 'https://discord.com/api/v10';
const PAGE = 100;
// Posts older than this are left to the daily check (the deal may be gone).
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

const SITES = {
  'earnfrombuying.com': { provider: 'la', name: 'LA' },
  'points4days.com': { provider: 'p4d', name: 'Points4Days' },
};
const DEAL_LINK = /https?:\/\/(?:www\.)?(earnfrombuying\.com|points4days\.com)\/f\/it@deals\/_arg\/([A-Za-z0-9+/_-]+={0,2})/i;

function config(env = process.env) {
  const token = String(env.DISCORD_BOT_TOKEN || '').trim();
  const channels = String(env.DISCORD_DEAL_CHANNELS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{5,30}$/.test(id));
  return { token, channels: [...new Set(channels)] };
}

const rot13 = (text) => text.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});

// The deal ID inside a cashout deal link, or null.
function dealIdFromLink(encoded) {
  try {
    const json = JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const id = typeof json?.vq === 'string' ? rot13(json.vq).trim() : '';
    return id && id.length <= 200 ? id : null;
  } catch {
    return null;
  }
}

const money = (text) => {
  const match = /\$?\s*([\d,]+(?:\.\d{1,2})?)/.exec(text || '');
  const value = match ? Number(match[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
};

// "LABEL: value" lines from everything the post shows, upper-cased labels.
function labelledLines(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\s*\**\s*([A-Z][A-Z0-9 ]{1,40}?)\s*\**\s*:\s*\**\s*(.*)$/.exec(line);
    if (match && !out.has(match[1].trim())) out.set(match[1].trim(), match[2].replace(/\*+/g, '').trim());
  }
  return out;
}

// One Discord message -> a deal in the adapters' shape (la.js toDeal), or null
// when it isn't a deal post this can read.
function parseDealPost(message) {
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  const parts = [message?.content || ''];
  for (const embed of embeds) {
    parts.push(embed?.url || '', embed?.title || '', embed?.description || '');
    for (const field of Array.isArray(embed?.fields) ? embed.fields : []) parts.push(`${field?.name || ''}: ${field?.value || ''}`);
  }
  const text = parts.join('\n');
  const link = DEAL_LINK.exec(text);
  if (!link) return null;
  const site = SITES[link[1].toLowerCase()];
  const id = dealIdFromLink(link[2]);
  if (!site || !id) return null;

  const lines = labelledLines(text);
  const price = money(lines.get('PRICE'));
  const total = money(lines.get('TOTAL'));
  const commission = money(lines.get('COMMISSION'));
  const payout = total ?? (price !== null && commission !== null ? Math.round((price + commission) * 100) / 100 : null);
  if (!payout) return null;

  const embed = embeds.find((e) => e?.title) || embeds[0] || {};
  const name = String(embed.title || lines.get('ACTIVE DEAL') || '').trim() || id;
  const notes = [
    lines.get('DELIVERY') && `Delivery: ${lines.get('DELIVERY')}`,
    lines.get('SPECIFICATIONS') && `Specifications: ${lines.get('SPECIFICATIONS')}`,
    ...[...lines.entries()].filter(([label]) => /^SHIP TO/.test(label)).map(([label, value]) => `${label.charAt(0)}${label.slice(1).toLowerCase()}: ${value}`),
    `From ${site.name}'s Discord. Store links and item details come with the next daily check.`,
  ].filter(Boolean);
  const dealUrl = link[0];

  return {
    id,
    provider: site.provider,
    name: name.slice(0, 300),
    imageUrl: embed.image?.url || embed.thumbnail?.url || null,
    retail: price,
    payout,
    profitMargin: price ? Math.round((payout - price) * 100) / 100 : 0,
    productLinks: [],
    categoryId: null,
    expiresAt: null,
    startsAt: null,
    featured: false,
    notes: notes.join('\n'),
    status: 'active',
    onSaleNow: null,
    createdAt: null,
    avgRemainingPercentage: null,
    commitRequired: null,
    dealUrl,
    source: 'discord',
    // One item so Log Purchase can record it before the daily check.
    items: [{ id, name: name.slice(0, 300), condition: 'new', upcs: [], sku: null, purchaseLinks: [], vendorLimit: null, remainingPercentage: null }],
  };
}

// Discord message IDs are snowflakes: bigger is newer.
const newer = (a, b) => (BigInt(a) > BigInt(b) ? 1 : BigInt(a) < BigInt(b) ? -1 : 0);
const sentAt = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);

async function discordGet(path, token, fetchImpl) {
  const response = await fetchImpl(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'ProfitTracker (deal alerts, 1.0)' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const reason = response.status === 401 ? 'the bot token was rejected'
      : response.status === 403 ? "the bot can't read that channel (add it to the server and give it View Channel and Read Message History)"
        : response.status === 404 ? 'no such channel'
          : response.status === 429 ? 'Discord rate limited us'
            : `Discord answered ${response.status}`;
    throw new Error(reason);
  }
  return response.json();
}

// New messages in one channel since the saved cursor, oldest first. The first
// read of a channel only remembers where it is, so following a channel doesn't
// announce what was posted before.
async function readChannel(channelId, token, fetchImpl) {
  const cursor = await prisma.discordDealCursor.findUnique({ where: { channel_id: channelId } });
  if (!cursor) {
    const latest = await discordGet(`/channels/${channelId}/messages?limit=1`, token, fetchImpl);
    const top = Array.isArray(latest) && latest[0]?.id;
    if (top) {
      await prisma.discordDealCursor.upsert({
        where: { channel_id: channelId },
        create: { channel_id: channelId, last_message_id: String(top) },
        update: { last_message_id: String(top) },
      });
    }
    return { messages: [], seeded: true };
  }

  const messages = [];
  let after = cursor.last_message_id;
  for (let page = 0; page < 5; page += 1) {
    const batch = await discordGet(`/channels/${channelId}/messages?after=${after}&limit=${PAGE}`, token, fetchImpl);
    if (!Array.isArray(batch) || batch.length === 0) break;
    batch.sort((a, b) => newer(a.id, b.id));
    messages.push(...batch);
    after = batch[batch.length - 1].id;
    if (batch.length < PAGE) break;
  }
  return { messages, seeded: false, last: messages.length ? messages[messages.length - 1].id : null };
}

// Adds deals the saved once-a-day list doesn't have yet to every connection of
// that cashout, so they show in Live Deals now. The daily check replaces the
// list (and with it these) with the site's own.
async function addToConnections(provider, deals) {
  const connections = await prisma.cashoutConnection.findMany({ where: { provider } });
  for (const conn of connections) {
    const cached = dealsCache.get(conn.id);
    const list = cached?.deals || (Array.isArray(conn.cached_deals) ? conn.cached_deals : null);
    // Nothing checked yet: the first check lists them anyway.
    if (!list) continue;
    const known = new Set(list.map((deal) => String(deal.id)));
    const fresh = deals.filter((deal) => !known.has(String(deal.id)));
    if (!fresh.length) continue;
    const next = [...fresh, ...list];
    await prisma.cashoutConnection.update({ where: { id: conn.id }, data: { cached_deals: next } });
    if (cached) dealsCache.set(conn.id, { ...cached, deals: next });
  }
}

/**
 * Reads new deal posts from the configured Discord channels. Best effort: a
 * failing channel is reported and skipped, and the cursor only moves past
 * posts that were handled, so nothing is lost when Discord or the database
 * hiccups.
 */
async function pullDiscordDeals({ env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const { token, channels } = config(env);
  if (!token || !channels.length) return { configured: false };

  const summary = { configured: true, channels: channels.length, posts: 0, deals: 0, alerts: 0, skipped: 0, errors: [] };
  for (const channelId of channels) {
    try {
      const { messages, seeded, last } = await readChannel(channelId, token, fetchImpl);
      if (seeded) {
        summary.seeded = (summary.seeded || 0) + 1;
        continue;
      }
      const byProvider = new Map();
      for (const message of messages) {
        summary.posts += 1;
        if (now - sentAt(message.id) > MAX_AGE_MS) { summary.skipped += 1; continue; }
        const deal = parseDealPost(message);
        if (!deal) { summary.skipped += 1; continue; }
        const list = byProvider.get(deal.provider) || new Map();
        list.set(deal.id, deal); // a later post of the same deal wins
        byProvider.set(deal.provider, list);
      }
      for (const [provider, list] of byProvider) {
        const deals = [...list.values()];
        const { created } = await recordDealsSeen(provider, deals, { now: new Date(now), keepKnown: true });
        await addToConnections(provider, deals);
        summary.deals += deals.length;
        summary.alerts += created;
      }
      if (last) {
        await prisma.discordDealCursor.update({ where: { channel_id: channelId }, data: { last_message_id: String(last) } });
      }
    } catch (err) {
      summary.errors.push(`${channelId}: ${err.message}`);
      console.warn(`[discord-deals] channel ${channelId}: ${err.message}`);
    }
  }
  return summary;
}

module.exports = { pullDiscordDeals, parseDealPost, dealIdFromLink, config };
