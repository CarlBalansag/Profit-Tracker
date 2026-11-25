import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const catalog = require('../services/cardCatalog.js');
const art = require('../services/cardArt.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { harness.reset(); catalog._resetForTests(); art._resetForTests(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => server.close());

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40)]);
const get = (path, headers = {}) => fetch(`${baseUrl}${path}`, { headers });

describe('normalizeArt', () => {
  it('keeps https pictures and the catalog\'s own copies', () => {
    expect(art.normalizeArt({ url: 'https://bank.example/card.png', local_path: 'images/us-x.webp' })).toEqual({ url: 'https://bank.example/card.png', mirror: 'images/us-x.webp' });
    expect(art.normalizeArt({ url: null, local_path: 'images/us-x.webp' })).toEqual({ url: null, mirror: 'images/us-x.webp' });
  });
  it('drops anything else', () => {
    for (const image of [null, undefined, 'x', {}, { url: 'http://bank.example/a.png' }, { url: 'javascript:alert(1)' }, { url: 'https://user:pw@bank.example/a.png' }, { url: 'https://bank.example:8443/a.png' }, { local_path: '../../.env' }, { local_path: 'images/a.svg' }]) {
      expect(art.normalizeArt(image)).toBe(null);
    }
  });
});

describe('where pictures may come from', () => {
  it('refuses private and local addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', 'not-an-ip']) {
      expect(art.isPublicAddress(address), address).toBe(false);
    }
    for (const address of ['8.8.8.8', '151.101.1.229', '2606:4700::1111']) expect(art.isPublicAddress(address), address).toBe(true);
  });
  it('never connects to them, by name or by number', async () => {
    await expect(art.download('https://localhost/a.png')).rejects.toThrow(/not public/);
    await expect(art.download('https://127.0.0.1/a.png')).rejects.toThrow(/site name/);
    await expect(art.download('https://[::1]/a.png')).rejects.toThrow(/site name/);
    await expect(art.download('http://example.com/a.png')).rejects.toThrow(/https/);
  });
});

describe('imageType', () => {
  it('goes by the bytes, and refuses SVG and pages', () => {
    expect(art.imageType(PNG)).toBe('image/png');
    expect(art.imageType(Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(20)]))).toBe('image/jpeg');
    expect(art.imageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('image/webp');
    expect(art.imageType(Buffer.from('0000ftypavif0000'))).toBe('image/avif');
    expect(art.imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(null);
    expect(art.imageType(Buffer.from('<!doctype html><html></html>'))).toBe(null);
    expect(art.imageType(Buffer.alloc(0))).toBe(null);
  });
});

describe('getArtwork', () => {
  const card = { url: 'https://bank.example/card.png', mirror: 'images/us-x.webp' };
  it('downloads once, even when asked many times together', async () => {
    const fetchImage = vi.fn(async () => PNG);
    const all = await Promise.all(Array.from({ length: 6 }, () => art.getArtwork(card, 'primary', { fetchImage })));
    expect(all.every((x) => x.type === 'image/png')).toBe(true);
    await art.getArtwork(card, 'primary', { fetchImage });
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });
  it('waits an hour before retrying a picture that failed', async () => {
    let time = 0;
    const now = () => time;
    const fetchImage = vi.fn(async () => { throw new Error('down'); });
    expect(await art.getArtwork(card, 'primary', { fetchImage, now })).toBe(null);
    expect(await art.getArtwork(card, 'primary', { fetchImage, now })).toBe(null);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    time = 61 * 60 * 1000;
    fetchImage.mockResolvedValueOnce(PNG);
    expect((await art.getArtwork(card, 'primary', { fetchImage, now })).type).toBe('image/png');
  });
  it('refuses what is not a picture, and cards with none', async () => {
    expect(await art.getArtwork(card, 'primary', { fetchImage: async () => Buffer.from('<html>blocked</html>') })).toBe(null);
    expect(await art.getArtwork(null, 'primary', { fetchImage: async () => PNG })).toBe(null);
    expect(await art.getArtwork({ url: null, mirror: null }, 'mirror', { fetchImage: async () => PNG })).toBe(null);
  });
  it('asks the catalog\'s own site for a mirror', async () => {
    const fetchImage = vi.fn(async () => PNG);
    await art.getArtwork(card, 'mirror', { fetchImage });
    expect(fetchImage).toHaveBeenCalledWith('https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/images/us-x.webp');
  });
});

describe('catalog artwork', () => {
  it('a saved copy from before artwork borrows it from the snapshot', async () => {
    const bundled = catalog.loadBundled().cards.find((c) => c.art?.url);
    const { art: _art, network_tier: _tier, ...old } = bundled;
    harness.db.cardCatalog.push({ id: catalog.SOURCE_ID, data: JSON.stringify([old, { ...old, id: 'us-unknown' }]), synced_at: new Date(), last_verified: null });
    const { cards, source } = await catalog.getCatalog(harness.prisma, { refresh: false });
    expect(source).toBe('synced');
    expect(cards[0].art).toEqual(bundled.art);
    expect(cards[1].art).toBe(null);
  });
  it('keeps a refreshed copy\'s own artwork, including "none"', async () => {
    const bundled = catalog.loadBundled().cards.find((c) => c.art?.url);
    harness.db.cardCatalog.push({ id: catalog.SOURCE_ID, data: JSON.stringify([{ ...bundled, art: null }]), synced_at: new Date(), last_verified: null });
    expect((await catalog.getCatalog(harness.prisma, { refresh: false })).cards[0].art).toBe(null);
  });
});

describe('routes', () => {
  it('names the pictures a card has, never their addresses', async () => {
    const id = catalog.loadBundled().cards.find((c) => c.art?.url).id;
    const body = await (await get(`/api/card-catalog/cards?ids=${id},us-nope,${id},../x`)).json();
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]).toMatchObject({ id, art: { primary: true } });
    expect(JSON.stringify(body)).not.toMatch(/https?:/);
    expect((await (await get('/api/card-catalog/cards')).json()).cards).toEqual([]);
    expect(await (await get('/api/card-catalog')).text()).not.toMatch(/"art"/);
  });
  it('answers 404 for cards and sources that do not exist', async () => {
    const none = catalog.loadBundled().cards.find((c) => !c.art).id;
    for (const path of [`/api/card-catalog/${none}/art/primary`, '/api/card-catalog/us-nope/art/primary', `/api/card-catalog/${none}/art/other`, '/api/card-catalog/%2e%2e%2fx/art/primary']) {
      expect((await get(path)).status, path).toBe(404);
    }
  });
  it('needs a sign-in', async () => {
    const out = { 'x-qa-unauthenticated': 'true' };
    for (const path of ['/api/card-catalog/cards?ids=us-amex-gold', '/api/card-catalog/us-amex-gold/art/primary', '/api/creditcard/paid-bills']) {
      expect((await get(path, out)).status, path).toBe(401);
    }
  });
  it('lists only this user\'s bills marked paid', async () => {
    const { ids } = harness;
    const state = (key, value, user_id = ids.user) => ({ id: key + user_id, user_id, key, state: value, until: null, updated_at: new Date() });
    harness.db.todoState.push(
      state(`card-due:${ids.card}:2026-12-01`, 'done'),
      state(`card-due:${ids.card}:2027-01-01`, 'snoozed'),
      state(`card-close:${ids.card}:2026-12-04`, 'done'),
      state(`card-due:${ids.foreign}:2026-12-01`, 'done', ids.other),
    );
    expect(await (await get('/api/creditcard/paid-bills')).json()).toEqual({ bills: [{ card_id: ids.card, due_date: '2026-12-01' }] });
  });
});
