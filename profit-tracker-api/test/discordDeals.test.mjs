// LA and Points4Days deal posts read from the user's Discord server (their
// deals channels followed into it), so alerts don't wait for the daily check.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { pullDiscordDeals, parseDealPost, dealIdFromLink } = require('../services/cashouts/discordDeals');
const { dealsCache } = require('../services/cashouts/service');
const laAdapter = require('../services/cashouts/la');
const p4dAdapter = require('../services/cashouts/p4d');

const NOW = Date.UTC(2026, 10, 26, 22, 16);
const rot13 = (text) => text.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});
const linkFor = (host, id) => `https://www.${host}/f/it@deals/_arg/${Buffer.from(JSON.stringify({ vq: rot13(id) })).toString('base64')}`;
const snowflake = (ms) => String(BigInt(ms - 1420070400000) << 22n);

// The shape of a post in LA's #above-cost-deals, as followed into a server.
function post({ at = NOW - 60_000, host = 'earnfrombuying.com', id = 'ROKU-STREAMING-STICK-2025HD', title = 'Streaming Stick 2025-HD Streaming Device for TV with Voice Remote', price = '$19.00', commission = '$2.00', total = '$21.00' } = {}) {
  return {
    id: snowflake(at),
    content: `NEW DEAL AT ${host === 'points4days.com' ? 'POINTS4DAYS' : 'EARNFROMBUYING'}:`,
    embeds: [{
      title,
      url: 'https://www.earnfrombuying.com',
      description: [
        `**ACTIVE DEAL:** ${title}`,
        `**DEAL LINK:** ${linkFor(host, id)}`,
        `**PRICE:** ${price}`,
        `**COMMISSION:** ${commission}`,
        `**TOTAL:** ${total}`,
        '**DELIVERY:** DROP OFF,SHIP DIRECT',
        '**SPECIFICATIONS:** ON SALE NOW, COMMITMENT REQUIRED',
        '**SHIP TO LOCATION 1:** 1 Chestnut St, Suite 5-E 5th Fl, Nashua, NH 03060',
      ].join('\n'),
      image: { url: 'https://cdn.example.invalid/roku.png' },
    }],
  };
}

const ENV = { DISCORD_BOT_TOKEN: 'test-only-token', DISCORD_DEAL_CHANNELS: '111111111111111111' };

// A fake Discord: GET messages returns `pages` in order; records each call.
function fakeDiscord(pages) {
  const calls = [];
  const queue = [...pages];
  const fetchImpl = vi.fn(async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    const body = queue.length ? queue.shift() : [];
    if (body instanceof Error) return { ok: false, status: Number(body.message), json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
  return { fetchImpl, calls };
}

const addConnection = (id, provider, cached) => harness.db.cashoutConnection.push({
  id, user_id: harness.ids.user, provider, display_name: provider.toUpperCase(), encrypted_key: 'x', key_last4: '1234', status: 'active',
  platform_id: null, last_synced_at: new Date(NOW - 3_600_000), last_error: null, cached_deals: cached, created_at: new Date(), updated_at: new Date(),
});

beforeEach(() => {
  harness.reset();
  dealsCache.clear();
  vi.restoreAllMocks();
});

describe('reading a deal post', () => {
  it('gets the deal ID from the link, and price, payout and notes from the post', () => {
    const deal = parseDealPost(post());
    expect(deal).toMatchObject({
      id: 'ROKU-STREAMING-STICK-2025HD',
      provider: 'la',
      name: 'Streaming Stick 2025-HD Streaming Device for TV with Voice Remote',
      retail: 19,
      payout: 21,
      status: 'active',
      source: 'discord',
      imageUrl: 'https://cdn.example.invalid/roku.png',
    });
    expect(deal.notes).toContain('Delivery: DROP OFF,SHIP DIRECT');
    expect(deal.notes).toContain('Ship to location 1: 1 Chestnut St');
    expect(deal.items).toHaveLength(1);
  });

  it('decodes a real deal link to the ID the daily check uses', () => {
    expect(dealIdFromLink('eyJ2cSI6Ik5DWS1WQ05RLU4xNi0xMS0yNTZUTy1GVllJUkUifQ==')).toBe('APL-IPAD-A16-11-256GB-SILVER');
  });

  it('knows Points4Days from its link, and adds price and commission when there is no total', () => {
    const deal = parseDealPost(post({ host: 'points4days.com', id: 'HP-14-OMNIBOOK', total: '' }));
    expect(deal).toMatchObject({ provider: 'p4d', id: 'HP-14-OMNIBOOK', retail: 19, payout: 21 });
  });

  it('skips posts it cannot read instead of saving half a deal', () => {
    expect(parseDealPost({ id: '1', content: 'Good morning!', embeds: [] })).toBeNull();
    expect(parseDealPost(post({ total: '', commission: '', price: '' }))).toBeNull();
    const badLink = post();
    badLink.embeds[0].description = badLink.embeds[0].description.replace(/_arg\/\S+/, '_arg/not-base64!!');
    expect(parseDealPost(badLink)).toBeNull();
  });
});

describe('pullDiscordDeals', () => {
  it('does nothing until the bot token and channels are set', async () => {
    const { fetchImpl } = fakeDiscord([]);
    expect(await pullDiscordDeals({ env: {}, fetchImpl, now: NOW })).toEqual({ configured: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("first only remembers where the channel is, so old posts aren't announced", async () => {
    const { fetchImpl, calls } = fakeDiscord([[post()]]);
    const summary = await pullDiscordDeals({ env: ENV, fetchImpl, now: NOW });
    expect(summary.seeded).toBe(1);
    expect(calls[0].url).toContain('/channels/111111111111111111/messages?limit=1');
    expect(calls[0].auth).toBe('Bot test-only-token');
    expect(harness.db.discordDealCursor).toEqual([expect.objectContaining({ channel_id: '111111111111111111', last_message_id: post().id })]);
    expect(harness.db.cashoutDealAlert).toHaveLength(0);
  });

  it('alerts a new deal once, adds it to Live Deals, and moves the cursor', async () => {
    const start = snowflake(NOW - 600_000);
    harness.db.discordDealCursor.push({ channel_id: '111111111111111111', last_message_id: start, updated_at: new Date() });
    // Another LA deal is already known, so this isn't the provider's first list.
    harness.db.cashoutDeal.push({ id: 'known', provider: 'la', external_deal_id: 'OLD-1', name: 'Old', payout: 10, retail: 9, stores: ['Amazon'], last_seen_at: new Date(NOW), first_seen_at: new Date(NOW), alerted_payout: 10 });
    const siteDeal = { id: 'OLD-1', name: 'Old', payout: 10, retail: 9, status: 'active', items: [] };
    addConnection('conn-la', 'la', [siteDeal]);
    addConnection('conn-p4d', 'p4d', []);

    const message = post();
    const { fetchImpl, calls } = fakeDiscord([[message]]);
    const fetchDeals = vi.spyOn(laAdapter, 'fetchDeals');
    const p4dFetch = vi.spyOn(p4dAdapter, 'fetchDeals');
    const summary = await pullDiscordDeals({ env: ENV, fetchImpl, now: NOW });

    expect(calls[0].url).toContain(`after=${start}`);
    expect(summary).toMatchObject({ posts: 1, deals: 1, alerts: 1, errors: [] });
    const row = harness.db.cashoutDeal.find((d) => d.external_deal_id === 'ROKU-STREAMING-STICK-2025HD');
    expect(row).toMatchObject({ provider: 'la', payout: 21, retail: 19 });
    // (The alert row itself is created nested in the deal; the in-memory test
    // database skips nested writes, dealAlertsPostgres.test.mjs covers them.)
    expect(harness.db.cashoutConnection.find((c) => c.id === 'conn-la').cached_deals.map((d) => d.id)).toEqual(['ROKU-STREAMING-STICK-2025HD', 'OLD-1']);
    expect(harness.db.cashoutConnection.find((c) => c.id === 'conn-p4d').cached_deals).toEqual([]);
    expect(harness.db.discordDealCursor[0].last_message_id).toBe(message.id);
    // Never signs in to the cashouts' sites.
    expect(fetchDeals).not.toHaveBeenCalled();
    expect(p4dFetch).not.toHaveBeenCalled();

    // The same deal posted again: no second alert, not added twice.
    const again = fakeDiscord([[post({ at: NOW - 30_000 })]]);
    const second = await pullDiscordDeals({ env: ENV, fetchImpl: again.fetchImpl, now: NOW });
    expect(second.alerts).toBe(0);
    expect(harness.db.cashoutDeal.filter((d) => d.external_deal_id === 'ROKU-STREAMING-STICK-2025HD')).toHaveLength(1);
    expect(harness.db.cashoutConnection.find((c) => c.id === 'conn-la').cached_deals).toHaveLength(2);
  });

  it("doesn't overwrite the store names the daily check saved", async () => {
    harness.db.discordDealCursor.push({ channel_id: '111111111111111111', last_message_id: snowflake(NOW - 600_000), updated_at: new Date() });
    harness.db.cashoutDeal.push({ id: 'd1', provider: 'la', external_deal_id: 'ROKU-STREAMING-STICK-2025HD', name: 'Roku', payout: 21, retail: 19, stores: ['Walmart'], image_url: 'https://site.example.invalid/a.png', last_seen_at: new Date(NOW - 3_600_000), first_seen_at: new Date(NOW - 3_600_000), alerted_payout: 21 });
    await pullDiscordDeals({ env: ENV, fetchImpl: fakeDiscord([[post()]]).fetchImpl, now: NOW });
    const row = harness.db.cashoutDeal.find((d) => d.id === 'd1');
    expect(row.stores).toEqual(['Walmart']);
    expect(harness.db.cashoutDealAlert).toHaveLength(0);
  });

  it('leaves posts older than a day to the daily check', async () => {
    harness.db.discordDealCursor.push({ channel_id: '111111111111111111', last_message_id: snowflake(NOW - 3 * 86_400_000), updated_at: new Date() });
    harness.db.cashoutDeal.push({ id: 'known', provider: 'la', external_deal_id: 'OLD-1', name: 'Old', payout: 10, last_seen_at: new Date(NOW), first_seen_at: new Date(NOW), alerted_payout: 10 });
    const old = post({ at: NOW - 2 * 86_400_000 });
    const summary = await pullDiscordDeals({ env: ENV, fetchImpl: fakeDiscord([[old]]).fetchImpl, now: NOW });
    expect(summary).toMatchObject({ posts: 1, skipped: 1, deals: 0 });
    expect(harness.db.cashoutDealAlert).toHaveLength(0);
    expect(harness.db.discordDealCursor[0].last_message_id).toBe(old.id);
  });

  it('keeps the cursor where it was when Discord refuses, and says why', async () => {
    const start = snowflake(NOW - 600_000);
    harness.db.discordDealCursor.push({ channel_id: '111111111111111111', last_message_id: start, updated_at: new Date() });
    const summary = await pullDiscordDeals({ env: ENV, fetchImpl: fakeDiscord([new Error('403')]).fetchImpl, now: NOW });
    expect(summary.errors[0]).toMatch(/can't read that channel/);
    expect(harness.db.discordDealCursor[0].last_message_id).toBe(start);
  });
});
