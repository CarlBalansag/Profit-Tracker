// Store templates: each store's order-number format and the subject lines it
// uses for each kind of email. Bump a template's version when it changes, so
// emails read by the old version are read again.
//
// Written from the public formats of these emails; the test fixtures are
// synthetic. Anything a template misses falls back to the generic reader.

const subjectKinds = (pairs) => (subject) => {
  for (const [kind, re] of pairs) if (re.test(subject)) return kind;
  return null;
};

// "Your Amazon.com order of "Echo Dot" and 2 more items" / Ordered: "Echo Dot..."
function amazonItemFromSubject(subject) {
  const m = subject.match(/(?:order of|Ordered:|Shipped:|Delivered:)\s*["“']([^"”']{3,150})["”']?/i);
  if (!m) return [];
  return [{ name: m[1].replace(/\.\.\.$|…$/, '').trim(), quantity: null, total: null }];
}

const { readCashoutReceipt, readCashoutCheck } = require('./cashoutReceipt');

// Since July 2026 Amazon's emails name categories, not items: "4 items:
// 1 Supplements, 1 Crafts, and 2 others", "1 Skin Care item", or in the
// subject "Ordered 5 items: Supplements, Skin Care, and more". Read as
// category items ({ name, quantity, category: true }) when no item is named.
function amazonCategories(subject, text) {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  const listed = lines.find((l) => /^\d+\s+items?:\s+.+/i.test(l));
  if (listed) {
    const parts = listed.replace(/^\d+\s+items?:\s+/i, '').split(/,\s*(?:and\s+)?|\s+and\s+/i).filter(Boolean);
    return parts.map((p) => {
      const m = p.match(/^(\d+)\s+(.+)$/);
      if (!m) return { name: p.trim(), quantity: null, category: true };
      return /^others?$/i.test(m[2].trim()) ? { name: 'Other items', quantity: Number(m[1]), category: true } : { name: m[2].trim(), quantity: Number(m[1]), category: true };
    }).slice(0, 10);
  }
  const single = lines.find((l) => /^(\d+)\s+(.{2,40}?)\s+items?$/i.test(l)) || (String(subject).match(/(\d+)\s+(.{2,40}?)\s+items?\s*$/i) || [])[0];
  if (single) {
    const m = single.match(/(\d+)\s+(.{2,40}?)\s+items?$/i);
    return [{ name: m[2].trim(), quantity: Number(m[1]), category: true }];
  }
  const fromSubject = String(subject).match(/(\d+)\s+items?:\s+(.+?)(?:,?\s+and more)?\s*$/i);
  if (fromSubject) {
    const parts = fromSubject[2].split(/,\s*/).filter(Boolean);
    return parts.map((p) => ({ name: p.trim(), quantity: parts.length === 1 ? Number(fromSubject[1]) : null, category: true })).slice(0, 10);
  }
  return [];
}

// "Carl - SACRAMENTO, CA" / "P4D - MIDDLETOWN, DE" under "Arriving": only the
// city and state are kept, never the name before the dash.
function amazonShipTo(text) {
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^.{1,60}?\s-\s([A-Z][A-Z .'-]{1,40}),\s([A-Z]{2})$/);
    if (m) return `${m[1].trim()}, ${m[2]}`;
  }
  return null;
}

const MERCHANTS = {
  // Cash-out receipts ("Enclosed is your RECEIPT - ID 211338"): the PDF lists
  // what was scanned in and what the balance was credited. Check notices
  // ("... has a check waiting for you for $1,478.25!"): the balance was paid
  // out as check number N.
  points4days: {
    version: 2,
    orderNumber: [/RECEIPT\s*-\s*ID\s*(\d{3,})/i, /receipts?\s*\(id\s*(\d{3,})\)/i],
    kind: subjectKinds([['check', /check waiting/i], ['payout', /receipt/i]]),
    read: (subject, text) => {
      const check = readCashoutCheck(subject, text);
      if (check) return { total: check.total, order_number: check.check_number ? `CHECK ${check.check_number}` : null };
      return readCashoutReceipt(text);
    },
  },
  amazon: {
    version: 2,
    orderNumber: [/\b(\d{3}-\d{7}-\d{7})\b/],
    kind: subjectKinds([
      ['cancelled', /cancel/i], ['refund', /refund/i], ['return', /return/i],
      ['delivered', /^delivered\b|has been delivered|was delivered/i],
      ['shipped', /^shipped\b|has shipped|out for delivery|on the way|arriving/i],
      ['order', /^ordered\b|your amazon(\.com)? order of|order confirmation/i],
    ]),
    items: (subject) => amazonItemFromSubject(subject),
    // Ship-to city/state always; categories only when no item is named.
    read: (subject, text) => {
      const categories = amazonCategories(subject, text);
      const shipTo = amazonShipTo(text);
      return shipTo || categories.length ? { ship_to: shipTo, items: categories, itemsIfMissing: true } : null;
    },
  },
  walmart: {
    version: 2,
    orderNumber: [/order\s*(?:number|#)?\s*[:#]?\s*(\d{7}-\d{8})\b/i, /\b(\d{7}-\d{8})\b/, /order\s*(?:number|#)\s*[:#]?\s*(\d{13,15})\b/i],
    kind: subjectKinds([
      ['cancelled', /cancel/i], ['refund', /refund/i], ['return', /return/i],
      ['pickup', /ready for pickup|ready to pick up/i],
      ['delivered', /delivered|has arrived/i],
      ['shipped', /shipped|on its way|out for delivery/i],
      // "Thanks for your curbside pickup order", "... delivery order".
      ['order', /thanks for your (?:[\w-]+ ){0,3}order|order (confirmation|received)|we got your order/i],
    ]),
    // The same order is written 2000143-55865102 and 200014355865102.
    normalizeOrder: (n) => (/^\d{15}$/.test(n) ? `${n.slice(0, 7)}-${n.slice(7)}` : n),
  },
  bestbuy: {
    version: 2,
    orderNumber: [/\b(BBY01-\d{12})\b/i],
    kind: subjectKinds([
      ['cancelled', /cancel/i], ['refund', /refund/i], ['return', /return/i],
      ['pickup', /ready for (store )?pickup|ready to pick up/i],
      ['delivered', /delivered/i], ['shipped', /shipped|on its way|out for delivery/i],
      ['order', /thanks for your order|order confirmation|we've received your order/i],
    ]),
  },
  target: {
    version: 1,
    orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*(\d{12,15})\b/i, /\b(9\d{11})\b/],
    kind: subjectKinds([
      ['cancelled', /cancel/i], ['refund', /refund/i], ['return', /return/i],
      ['pickup', /ready for (pickup|drive up)|ready to pick up/i],
      ['delivered', /delivered|has arrived/i], ['shipped', /shipped|on its way/i],
      ['order', /thanks for your order|order (confirmation|placed)|we got your order/i],
    ]),
  },
  apple: {
    version: 3,
    orderNumber: [/\b(W\d{9,10})\b/],
    kind: subjectKinds([
      ['cancelled', /cancel/i], ['refund', /refund/i], ['return', /return/i],
      ['pickup', /ready for pickup/i], ['delivered', /delivered/i], ['shipped', /shipped|on its way/i],
      ['order', /we're processing your order|thank you for your order|order confirmation/i],
      ['receipt', /your receipt from apple/i],
    ]),
  },
  costco: { version: 1, orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*(\d{9,11})\b/i] },
  samsclub: { version: 1, orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*(\d{9,13})\b/i] },
  homedepot: { version: 2, orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*([A-Z]{0,2}\d{8,12})\b/i] },
  lowes: { version: 1, orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*(\d{9,12})\b/i] },
  gamestop: { version: 1, orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*(\d{10,16})\b/i] },
  nike: { version: 1, orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*(C\d{10,12})\b/i] },
  ebay: {
    version: 1,
    orderNumber: [/order\s*(?:number|#)?\s*[:#]?\s*(\d{2}-\d{5}-\d{5})\b/i, /\b(\d{2}-\d{5}-\d{5})\b/],
    kind: subjectKinds([
      ['sale', /you made the sale|your item sold|sold:|you sold/i],
      ['payout', /payout/i], ['refund', /refund/i], ['return', /return/i], ['cancelled', /cancel/i],
      ['delivered', /delivered/i], ['shipped', /shipped|on its way/i],
      ['order', /order confirmed|your order is confirmed|thanks for your purchase/i],
    ]),
  },
  stockx: {
    version: 1,
    orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*(\d{6,10}-\d{6,10})\b/i, /\b(\d{8}-\d{8})\b/],
    kind: subjectKinds([
      ['sale', /you sold|ask (was )?matched|congrats.*sold/i], ['payout', /payout/i],
      ['delivered', /delivered/i], ['shipped', /shipped|on its way/i],
      ['order', /order confirmed|your order has been confirmed|bid (was )?accepted/i],
    ]),
  },
  goat: {
    version: 1,
    kind: subjectKinds([
      ['sale', /sold|congrats/i], ['payout', /cash ?out/i],
      ['delivered', /delivered/i], ['shipped', /shipped/i], ['order', /order confirmed|thanks for your order/i],
    ]),
  },
  paypal: {
    version: 1,
    orderNumber: [/transaction id\s*[:#]?\s*([A-Z0-9]{17})\b/i],
    kind: subjectKinds([
      ['sale', /you've got money|you received a payment|payment received/i],
      ['refund', /refund/i], ['receipt', /receipt for your payment|you sent a payment|you paid/i],
    ]),
  },
  pirateship: {
    version: 1,
    kind: subjectKinds([['receipt', /receipt|label(s)? purchased|you bought/i]]),
  },
  ups: { version: 1, carrier: true },
  fedex: { version: 1, carrier: true },
  usps: { version: 1, carrier: true },
};

module.exports = { MERCHANTS };
