// Store-independent reading of an order/shipping email's text: money lines,
// order numbers, tracking numbers, the card used, and what kind of email it
// is. Every value carries a confidence so the review screens can say "check
// this" instead of guessing. Deterministic: no AI, nothing leaves the server.

const MONEY = String.raw`-?\(?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+(?:\.\d{2}))\)?`;

// "$1,234.56" -> "1234.56" (string, for Decimal columns). Parentheses or a
// leading minus mean a negative amount.
function money(raw) {
  if (raw == null) return null;
  const s = String(raw);
  const m = s.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const negative = /^\s*[-(]|-\s*\$/.test(s);
  return (negative ? -n : n).toFixed(2);
}

// The amount on the same line as a label, or on the next line (many HTML
// receipts put the label and the amount in separate table cells).
function labelledAmount(text, labels) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const re = new RegExp(`^(?:${labels})\\b[^$\\d-]{0,30}`, 'i');
  for (let i = 0; i < lines.length; i += 1) {
    if (!re.test(lines[i])) continue;
    const here = lines[i].match(new RegExp(MONEY));
    if (here) return money(here[0]);
    const next = lines[i + 1] && lines[i + 1].match(new RegExp(`^${MONEY}$`));
    if (next) return money(next[0]);
  }
  return null;
}

const LABELS = {
  // A bare "Total" must not be "Total Fee", "Total Tax" or "Total # of items".
  total: 'order total|grand total|total charged|total paid|amount paid|payment total|total \\(usd\\)|total(?!\\s*(?:fee|tax|#|of\\b|items?|savings|saved|discount|before|due later))',
  subtotal: 'item\\(?s\\)? subtotal|items subtotal|merchandise subtotal|subtotal',
  tax: 'total tax|estimated tax|sales tax|tax collected|estimated sales tax|tax',
  shipping: 'shipping & handling|shipping and handling|shipping|delivery fee|delivery',
  discount: 'promotion applied|promotions?|discounts?|savings|coupons?|you saved',
};

function amounts(text) {
  const out = {};
  for (const [field, labels] of Object.entries(LABELS)) {
    const value = labelledAmount(text, labels);
    if (value != null) out[field] = value;
  }
  // Discounts are shown both as "-$5.00" and "$5.00"; store them positive.
  if (out.discount) out.discount = Math.abs(Number(out.discount)).toFixed(2);
  // "Free" shipping.
  if (out.shipping == null && /\bshipping[^\n]{0,20}\bfree\b/i.test(text)) out.shipping = '0.00';
  return out;
}

// Labelled order numbers ("Order #112-...", "Order number: 2000...").
// A candidate must contain a digit and not be a date, price or phone number.
function orderNumber(text) {
  const re = /\b(?:order|confirmation)\s*(?:number|no\.?|id|#)?\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]{4,30})/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[1].replace(/-+$/, '');
    if (!/\d/.test(v) || /^\d{1,4}$/.test(v)) continue;
    if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(v)) continue;
    return v.toUpperCase();
  }
  return null;
}

// UPS, USPS and FedEx formats, plus "Tracking number: X" labels.
function trackingNumbers(text) {
  const found = [];
  const add = (v) => { const t = v.replace(/\s+/g, '').toUpperCase(); if (!found.includes(t)) found.push(t); };
  for (const m of text.matchAll(/\b(1Z[0-9A-Z]{16})\b/gi)) add(m[1]);
  for (const m of text.matchAll(/\b(9[1-5]\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2,6})\b/g)) add(m[1]);
  for (const m of text.matchAll(/tracking\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9]{10,34})\b/gi)) {
    if (/\d/.test(m[1])) add(m[1]);
  }
  return found.slice(0, 5);
}

const CARD = /\b(visa|mastercard|master card|amex|american express|discover|debit card|credit card)\b[^\n\d]{0,40}?(?:ending(?: in)?|\*{2,}|•{2,}|x{2,}|-)\s*(\d{4})\b/i;
function paymentHint(text) {
  const m = text.match(CARD);
  if (!m) return null;
  const brand = m[1].toLowerCase()
    .replace('master card', 'mastercard').replace('american express', 'amex');
  const label = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover', 'debit card': 'Debit', 'credit card': 'Card' }[brand] || 'Card';
  return `${label} ${m[2]}`;
}

// Order of checks matters: a "cancelled" email often repeats "order placed".
const KINDS = [
  ['tax_form', /\b(1099-?K|1099-?NEC|1099-?MISC)\b|\btax (form|document)s? (is |are )?(now )?(ready|available)\b/i],
  ['cancelled', /\b(cancel+ed|cancel+ation|has been cancel+ed|order was cancel+ed)\b/i],
  ['refund', /\b(refund(ed)?|your refund|credit has been issued)\b/i],
  ['return', /\b(return (received|started|label|request)|we received your return|your return)\b/i],
  ['payout', /\b(payout|cash ?out|transferred to your bank|deposit(ed)? to your)\b/i],
  ['sale', /\b(you sold|you made the sale|your item (has )?sold|item sold|ask (was )?matched|congrats.{0,20}sold|you've got money|you received a payment)\b/i],
  ['delivered', /\b(delivered|has arrived|was delivered)\b/i],
  ['pickup', /\b(ready for pick ?up|ready to pick up)\b/i],
  ['shipped', /\b(shipped|on (its|the) way|out for delivery|in transit|tracking number|label created)\b/i],
  ['order', /\b(thanks for your (?:[\w-]+ ){0,3}order|thank you for your (?:[\w-]+ ){0,3}order|order (confirmation|confirmed|received|placed)|we('ve| have) received your order|your order of|ordered:|order #)\b/i],
  ['receipt', /\b(receipt|invoice|payment (received|confirmation)|your purchase)\b/i],
];
function kindOf(subject, text) {
  for (const [kind, re] of KINDS) if (re.test(subject || '')) return kind;
  const top = String(text || '').slice(0, 1500);
  for (const [kind, re] of KINDS) if (re.test(top)) return kind;
  return 'other';
}

// Marketing mail from an allow-listed store: no order number, no amounts
// that look like a purchase, and the usual newsletter wording.
function looksLikeMarketing(subject, text) {
  return /\b(% off|sale ends|deals?|shop now|new arrivals|limited time|black friday|cyber monday|top picks|recommended for you)\b/i.test(subject || '')
    || (/\bunsubscribe\b/i.test(text || '') && !/\border\b/i.test(subject || ''));
}

// Sign-in codes, password and account-security notices. Never order mail, and
// not kept: the subject is dropped and the body is never downloaded.
function looksPrivate(subject) {
  return /\b(verification|security|one[- ]time|sign[- ]?in|login|access) code\b|\bpass ?code\b|\bpassword\b|\bmulti[- ]?factor\b|\btwo[- ](step|factor)\b|\b2fa\b|\bverify your (email|account|identity|phone)\b|\bvalidate your email\b|\brecovery (email|phone)\b|\buser ?id\b|\bsecurity (alert|preference|notice|settings?)\b|\bnew sign[- ]?in\b|\bunusual (activity|sign)/i.test(subject || '');
}

// "2 x Widget  $19.98", "Qty: 2" next to a name and a price. Weak: shown as
// "check this" (confidence 0.4) unless a store template or schema.org agrees.
function items(text) {
  const out = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length && out.length < 50; i += 1) {
    const line = lines[i];
    let m = line.match(/^(\d{1,3})\s*[x×]\s+(.{3,120}?)\s+\$\s?([\d,]+\.\d{2})$/i);
    if (m) { out.push({ name: m[2].trim(), quantity: Number(m[1]), total: money(m[3]) }); continue; }
    m = line.match(/^(?:qty|quantity)\s*[:.]?\s*(\d{1,3})\b/i);
    if (m && i > 0) {
      // The line before is the item: "Name" or "Name  $12.34".
      const prev = lines[i - 1].match(/^(.{3,150}?)\s+\$\s?([\d,]+\.\d{2})$/);
      const name = prev ? prev[1].trim() : lines[i - 1];
      if (name.length >= 3 && !/\$|total|subtotal|order/i.test(name)) {
        const price = prev ? prev[2] : (lines[i].match(new RegExp(MONEY)) || lines[i + 1]?.match(new RegExp(`^${MONEY}$`)) || [])[0];
        out.push({ name, quantity: Number(m[1]), total: price ? money(price) : null });
      }
    }
  }
  return out;
}

module.exports = { money, amounts, orderNumber, trackingNumbers, paymentHint, kindOf, looksLikeMarketing, looksPrivate, items, labelledAmount, MONEY };
