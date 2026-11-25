// Card artwork for the Credit Card page.
//
// The catalog (services/cardCatalog.js) knows where each issuer keeps a picture
// of the card. Browsers can't load those directly in a useful way: many issuer
// sites refuse other sites, and none of them let a page measure the picture.
// So the API fetches a picture once, checks it really is one, and serves it
// from our own address.
//
// Only addresses in the catalog are ever fetched (the caller names a card, not
// a URL), over https, and never from a private network address -- the catalog
// is community data, so its addresses aren't trusted.
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

// The catalog's own copy of a few pictures.
const MIRROR_BASE = 'https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/';
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;
const KEEP_IMAGES = 80; // in memory; browsers keep their own copies for a month
const KEEP_FAILURE_MS = 60 * 60 * 1000;

const httpsUrl = (value) => {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    return url.href;
  } catch {
    return null;
  }
};

// OpenCard DB's `image` -> what we keep: { url, mirror }, or null.
function normalizeArt(image) {
  if (!image || typeof image !== 'object') return null;
  const url = httpsUrl(image.url);
  const mirror = typeof image.local_path === 'string' && /^images\/[a-z0-9-]{1,120}\.(webp|png|jpg)$/.test(image.local_path) ? image.local_path : null;
  return url || mirror ? { url, mirror } : null;
}

// Which pictures exist, without their addresses: all a page needs to know.
const artSources = (art) => ({ primary: Boolean(art?.url), mirror: Boolean(art?.mirror) });

const sourceUrl = (art, source) => {
  if (source === 'mirror') return art?.mirror ? MIRROR_BASE + art.mirror : null;
  return art?.url || null;
};

// ─── Addresses ────────────────────────────────────────────────────────────────
const blocked = new net.BlockList();
for (const [range, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(range, bits, 'ipv4');
for (const [range, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16]]) blocked.addSubnet(range, bits, 'ipv6');

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (mapped) {
    const v4 = mapped[1] || [mapped[2], mapped[3]].map((h) => parseInt(h, 16)).flatMap((n) => [n >> 8, n & 255]).join('.');
    return isPublicAddress(v4);
  }
  return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// Used for the connection itself, so the address that was checked is the
// address that is connected to.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) return callback(new Error('Artwork address is not public'));
    return options?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
  });
}

// What the bytes really are, whatever the server called them. SVG isn't here:
// it can carry scripts.
function imageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buf.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (['ftypavif', 'ftypavis'].includes(buf.subarray(4, 12).toString('latin1'))) return 'image/avif';
  return null;
}

function download(address, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = httpsUrl(address);
    if (!url) return reject(new Error('Artwork address is not https'));
    if (net.isIP(new URL(url).hostname.replace(/^\[|\]$/g, ''))) return reject(new Error('Artwork address is not a site name'));
    const req = https.get(url, {
      lookup: publicLookup,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; card artwork)', Accept: 'image/avif,image/webp,image/png,image/jpeg' },
    }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('Artwork redirected too many times'));
        let next;
        try { next = new URL(headers.location, url).href; } catch { return reject(new Error('Artwork redirect is broken')); }
        return resolve(download(next, redirects + 1));
      }
      if (statusCode !== 200) { res.resume(); return reject(new Error(`Artwork answered ${statusCode}`)); }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) { req.destroy(new Error('Artwork is too large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
      return undefined;
    });
    // Covers the whole download, not just a quiet connection.
    const timer = setTimeout(() => req.destroy(new Error('Artwork took too long')), TIMEOUT_MS);
    req.on('close', () => clearTimeout(timer));
    req.on('timeout', () => req.destroy(new Error('Artwork took too long')));
    req.on('error', reject);
    return undefined;
  });
}

// ─── Cache ────────────────────────────────────────────────────────────────────
const images = new Map(); // url -> { type, buf } | { failedAt }
const loading = new Map();

function remember(url, entry) {
  images.delete(url);
  images.set(url, entry);
  while (images.size > KEEP_IMAGES) images.delete(images.keys().next().value);
}

// { type, buf }, or null when there is no usable picture.
async function getArtwork(art, source, { fetchImage = download, now = Date.now } = {}) {
  const url = sourceUrl(art, source);
  if (!url) return null;
  const known = images.get(url);
  if (known?.buf) { remember(url, known); return known; }
  if (known && now() - known.failedAt < KEEP_FAILURE_MS) return null;
  // Several people (or one page's several cards) asking at once share one download.
  if (!loading.has(url)) {
    loading.set(url, (async () => {
      try {
        const buf = await fetchImage(url);
        const type = imageType(buf);
        if (!type || buf.length > MAX_BYTES) throw new Error('Artwork is not a picture');
        remember(url, { type, buf });
        return { type, buf };
      } catch (err) {
        console.warn('[cardArt]', new URL(url).hostname, err.message);
        remember(url, { failedAt: now() });
        return null;
      } finally {
        loading.delete(url);
      }
    })());
  }
  return loading.get(url);
}

const _resetForTests = () => { images.clear(); loading.clear(); };

module.exports = { normalizeArt, artSources, getArtwork, isPublicAddress, imageType, download, MAX_BYTES, _resetForTests };
