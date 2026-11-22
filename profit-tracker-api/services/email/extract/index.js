// Reads one email (raw source) into order details, best source first:
//   1. schema.org structured data embedded by the store
//   2. the store's template (order-number format, subject lines)
//   3. generic text reading (labelled amounts, tracking formats, card)
// The raw email and its body are only held in memory while reading.
const { simpleParser } = require('mailparser');
const { convert } = require('html-to-text');
const generic = require('./generic');
const { fromSchemaOrg } = require('./schemaOrg');
const { MERCHANTS } = require('./merchants');

const GENERIC_VERSION = 5;
const MAX_SOURCE = 512 * 1024;

// One number per store, so a change to either the shared reader or a store's
// template re-reads that store's emails.
const parserVersion = (merchant) => GENERIC_VERSION * 1000 + (MERCHANTS[merchant]?.version || 0);

const TEXT_OPTIONS = {
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'table', format: 'block' },
    { selector: 'tr', format: 'block' },
    { selector: 'td', format: 'inlineSurround', options: { suffix: '  ' } },
    { selector: 'th', format: 'inlineSurround', options: { suffix: '  ' } },
  ],
};

function cleanText(text) {
  return String(text || '')
    .replace(/ |&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function parseSource(source, { maxBytes = MAX_SOURCE } = {}) {
  const buf = Buffer.isBuffer(source) ? source : Buffer.from(String(source || ''));
  const mail = await simpleParser(buf.subarray(0, maxBytes), { skipImageLinks: true, skipTextLinks: true, skipTextToHtml: true });
  const html = typeof mail.html === 'string' ? mail.html : '';
  const text = cleanText(html ? convert(html, TEXT_OPTIONS) : mail.text || '');
  return {
    subject: mail.subject || '',
    html,
    text,
    attachments: (mail.attachments || []).map((a) => ({ filename: a.filename || null, contentType: a.contentType, size: a.size, content: a.content })),
  };
}

const CONF = { schema: 0.95, template: 0.85, generic: 0.6, weak: 0.4 };

function firstMatch(patterns, text) {
  for (const re of patterns || []) {
    const m = text.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// merchant: the allow-list key from the sender. subject/html/text from parseSource.
function extractEmail({ merchant, subject = '', html = '', text = '' }) {
  const template = MERCHANTS[merchant] || {};
  const schema = fromSchemaOrg(html);
  const out = { confidence: {} };
  const set = (field, value, conf) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (out[field] != null && (out.confidence[field] || 0) >= conf) return;
    out[field] = value;
    out.confidence[field] = conf;
  };
  const sources = [];

  // Kind
  if (schema.fields.kind) { set('kind', schema.fields.kind, CONF.schema); sources.push('schema.org'); }
  const templateKind = template.kind ? template.kind(subject) : null;
  if (templateKind) set('kind', templateKind, CONF.template);
  set('kind', generic.kindOf(subject, text), CONF.generic);

  // Order number
  set('order_number', schema.fields.order_number, CONF.schema);
  const templateOrder = firstMatch(template.orderNumber, `${subject}\n${text}`);
  set('order_number', templateOrder, CONF.template);
  if (!template.carrier) set('order_number', generic.orderNumber(`${subject}\n${text}`), CONF.weak);

  // Money
  set('total', schema.fields.total, CONF.schema);
  const amounts = generic.amounts(text);
  for (const field of ['total', 'subtotal', 'tax', 'shipping', 'discount']) set(field, amounts[field], CONF.generic);
  set('currency', schema.fields.currency, CONF.schema);

  // Items
  if (schema.items.length) set('items', schema.items, CONF.schema);
  // Item lines in the body beat the single item named in a subject line.
  const fromText = generic.items(text);
  set('items', fromText, CONF.weak);
  const fromTemplate = !fromText.length && template.items ? template.items(subject, text) : [];
  set('items', fromTemplate, CONF.weak);

  // A store's own reader for its receipt layout (cash-out receipts).
  const own = template.read ? template.read(subject, text) : null;
  if (own) {
    set('items', own.items, CONF.template);
    set('total', own.total, CONF.template);
    set('order_number', own.order_number, CONF.template);
    sources.push(`${merchant}@${template.version}`);
  }

  // Tracking and card
  const tracking = [...new Set([...schema.tracking, ...generic.trackingNumbers(`${subject}\n${text}`)])].slice(0, 5);
  set('tracking_numbers', tracking, schema.tracking.length ? CONF.schema : CONF.template);
  set('payment_hint', schema.fields.payment_hint || generic.paymentHint(text), schema.fields.payment_hint ? CONF.schema : CONF.generic);

  // Totals that disagree with their parts lower the total's confidence.
  if (out.total && out.subtotal) {
    const parts = Number(out.subtotal) + Number(out.tax || 0) + Number(out.shipping || 0) - Number(out.discount || 0);
    if (Math.abs(parts - Number(out.total)) > 0.02 && out.confidence.total < CONF.schema) out.confidence.total = CONF.weak;
  }

  // A carrier email only matters when it carries a tracking number; carriers
  // also send ads, account notices and sign-in codes.
  if (template.carrier) {
    out.kind = !out.tracking_numbers ? 'other'
      : ['shipped', 'delivered', 'pickup'].includes(out.kind) ? out.kind
        : /deliver/i.test(subject) ? 'delivered' : 'shipped';
  }
  if (generic.looksPrivate(subject)) out.kind = 'other';

  if (out.order_number && template.normalizeOrder) out.order_number = template.normalizeOrder(String(out.order_number));
  // A $0.00 total ("Order Change" notices, gift-card balance lines) never helps.
  for (const f of ['total', 'subtotal']) if (out[f] != null && Number(out[f]) === 0) { delete out[f]; delete out.confidence[f]; }
  // Nothing to link by: no order number, tracking number or total (store
  // ads that mention "delivered", "your account has been closed", ...).
  const empty = !out.order_number && !out.tracking_numbers && out.total == null && out.kind !== 'tax_form';

  const marketing = empty || out.kind === 'other' || (generic.looksLikeMarketing(subject, text) && !out.order_number && !out.tracking_numbers);
  if (templateOrder || templateKind) sources.push(`${merchant}@${template.version}`);
  sources.push(`generic@${GENERIC_VERSION}`);

  return {
    status: marketing ? 'ignored' : 'extracted',
    kind: marketing ? (out.kind === 'other' ? 'other' : out.kind) : out.kind,
    order_number: out.order_number ? String(out.order_number).slice(0, 64) : null,
    currency: out.currency || 'USD',
    total: out.total ?? null,
    subtotal: out.subtotal ?? null,
    tax: out.tax ?? null,
    shipping: out.shipping ?? null,
    discount: out.discount ?? null,
    tracking_numbers: out.tracking_numbers || [],
    items: out.items ? out.items.slice(0, 50) : null,
    payment_hint: out.payment_hint || null,
    confidence: out.confidence,
    parser: [...new Set(sources)].join(' + '),
    parser_version: parserVersion(merchant),
  };
}

module.exports = { parseSource, extractEmail, parserVersion, cleanText, GENERIC_VERSION };
