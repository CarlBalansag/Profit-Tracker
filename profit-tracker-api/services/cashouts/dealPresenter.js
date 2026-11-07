// Shapes a normalized adapter deal (eb.js's fetchDeals() output) into the
// flat, snake_case JSON the MCP tools return. Deliberate copy of the math
// and note-parsing in profit-tracker-app/src/utils/cashoutDeals.js -- that
// file is ESM and browser-facing, this one is CommonJS and server-facing,
// so the two can't share code directly. Keep them in sync by hand.

// Same rounding as shared/finance.mjs's roundCents, duplicated for the same
// reason as the comment above.
const roundCents = (n) => Math.round(n * 100) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;

const roundTo1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

// Known affiliate/tracking params to strip from a store URL -- tag, ref,
// click-tracking IDs and every utm_* variant. Anything else (sku, skuId,
// a real color/size variant param) is left alone: this is a blocklist of
// known trackers, not an allowlist, so an unrecognized but legitimate param
// is never silently dropped.
const TRACKING_PARAMS = new Set([
  'tag', 'ref', 'ref_', 'irgwc', 'irclickid', 'clickid', 'click_id', 'wmlspartner',
  'affiliate', 'aff', 'affid', 'subid', 'pubref', 'cjevent', 'awc', 'ad', 'adid', 'campaignid',
]);
function cleanStoreUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || /^utm_/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// payout minus retail, before tax, shipping or coupons -- not a guarantee of
// take-home profit, just the gap between what the cashout pays and list price.
function spreadVsRetail(payout, retail) {
  if (!(payout > 0) || !(retail > 0)) return null;
  return {
    amount: roundCents(payout - retail),
    pct: roundCents(((payout - retail) / retail) * 100),
  };
}

// EB sends one free-text notes blob, never structured fields. This pulls out
// a coupon code, a delivery restriction, and a best-effort address -- all
// three are absent (null) when the notes don't mention them, which is the
// only thing null means here. There is no separate "ship anywhere" signal.
function parseNotes(notes) {
  const lines = String(notes || '').split('\n').map((line) => line.trim());
  let coupon = null;
  let deliveryRestriction = null;
  const addressLines = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const delivery = line.match(/^deliver to:\s*(.+)$/i);
    const dropship = line.match(/dropship to:\s*(.*)$/i);
    const code = line.match(/^use code:\s*([a-z0-9_-]+)/i);

    if (delivery) {
      deliveryRestriction = delivery[1];
    } else if (dropship) {
      if (dropship[1]) addressLines.push(dropship[1]);
      while (lines[i + 1]) {
        i += 1;
        addressLines.push(lines[i]);
      }
    } else if (code) {
      coupon = code[1];
    }
  }

  if (addressLines.length === 0) {
    return { coupon, deliveryRestriction, shipToAddress: null };
  }

  // Best-effort split: last line as "City, ST ZIP" if it matches, first line
  // as a name, anything in between as street lines. A shape this parser
  // hasn't seen yet lands in line1/line2 unsplit rather than silently dropped.
  const cityStateZip = /^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/;
  const last = addressLines[addressLines.length - 1];
  const match = last.match(cityStateZip);

  const shipToAddress = {
    parsed: true,
    name: addressLines[0] || null,
    line1: null,
    line2: null,
    city: null,
    state: null,
    zip: null,
    raw: addressLines.join('\n'),
  };
  const middle = match ? addressLines.slice(1, -1) : addressLines.slice(1);
  shipToAddress.line1 = middle[0] || null;
  shipToAddress.line2 = middle[1] || null;
  if (match) {
    shipToAddress.city = match[1];
    shipToAddress.state = match[2];
    shipToAddress.zip = match[3];
  }

  return { coupon, deliveryRestriction, shipToAddress };
}

function presentDeal(deal, connection) {
  const payout = Number(deal.payout);
  const retail = deal.retail === null || deal.retail === undefined ? null : Number(deal.retail);
  const expiresAt = deal.expiresAt ? new Date(deal.expiresAt) : null;
  const now = Date.now();
  const { coupon, deliveryRestriction, shipToAddress } = parseNotes(deal.notes);

  const items = (deal.items || []).map((item) => {
    const upc = item.upcs?.[0] || null;
    return {
      item_id: item.id,
      name: item.name,
      condition: item.condition,
      // UPC or manufacturer model/part number -- EB sometimes puts a model
      // number here instead of a real UPC (e.g. "83K4000QUS"). id_type is a
      // best guess from the value's shape: a 12-13 digit string looks like a
      // real UPC/EAN, anything else is treated as a model/part number.
      upc,
      id_type: upc ? (/^\d{12,13}$/.test(upc) ? 'upc' : 'model') : null,
      vendor_limit: item.vendorLimit ?? null,
      remaining_percentage: roundTo1(item.remainingPercentage),
      // Always null in every deal seen so far; no documented meaning from EB.
      // Passed through as-is rather than translated into a confident flag.
      commitment: item.commitment ?? null,
      stores: (item.purchaseLinks || []).map((link) => ({ name: link.name, url: cleanStoreUrl(link.url) })),
    };
  });

  const vendorLimits = items.map((i) => i.vendor_limit).filter((n) => n > 0);

  return {
    id: deal.id,
    name: deal.name,
    image_url: deal.imageUrl || null,
    cashout: connection.displayName || connection.provider,
    currency: 'USD',
    payout,
    retail,
    spread_vs_retail: spreadVsRetail(payout, retail),
    vendor_limit_total: vendorLimits.length ? vendorLimits.reduce((a, b) => a + b, 0) : null,
    featured: Boolean(deal.featured),
    status: deal.status,
    // The deal's own expiration, not an arrival/delivery deadline -- EB has
    // no separate field for that.
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    is_expired: expiresAt ? expiresAt.getTime() <= now : false,
    days_left: expiresAt ? Math.ceil((expiresAt.getTime() - now) / DAY_MS) : null,
    avg_remaining_percentage: roundTo1(deal.avgRemainingPercentage),
    coupon_code: coupon,
    delivery_restriction: deliveryRestriction,
    ship_to_address: shipToAddress,
    notes_raw: deal.notes || null,
    items,
  };
}

module.exports = { presentDeal, spreadVsRetail, parseNotes };
