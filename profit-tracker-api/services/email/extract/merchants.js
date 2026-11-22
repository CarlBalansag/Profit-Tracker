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

const { readCashoutReceipt } = require('./cashoutReceipt');

const MERCHANTS = {
  // Cash-out receipts ("Enclosed is your RECEIPT - ID 211338"): the PDF lists
  // what was scanned in and what the balance was credited.
  points4days: {
    version: 1,
    orderNumber: [/RECEIPT\s*-\s*ID\s*(\d{3,})/i, /receipts?\s*\(id\s*(\d{3,})\)/i],
    kind: subjectKinds([['payout', /receipt/i]]),
    read: (subject, text) => readCashoutReceipt(text),
  },
  amazon: {
    version: 1,
    orderNumber: [/\b(\d{3}-\d{7}-\d{7})\b/],
    kind: subjectKinds([
      ['cancelled', /cancel/i], ['refund', /refund/i], ['return', /return/i],
      ['delivered', /^delivered:|has been delivered|was delivered/i],
      ['shipped', /^shipped:|has shipped|out for delivery|on the way|arriving/i],
      ['order', /^ordered:|your amazon(\.com)? order of|order confirmation/i],
    ]),
    items: (subject) => amazonItemFromSubject(subject),
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
    version: 1,
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
    version: 1,
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
  homedepot: { version: 1, orderNumber: [/order\s*(?:number|#)\s*[:#]?\s*([A-Z]{0,2}\d{8,12})\b/i] },
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
