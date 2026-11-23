import { accountLabel } from './storeAccounts';

// Store order exports (Settings > Data > Fill in costs from store orders).
// The columns the server reads (see AMAZON_COLUMNS in fillCosts.js). Everything
// else, like shipping and billing addresses, never leaves the browser, which
// also keeps years of order history under the upload limit.
const KEEP_COLUMNS = new Set([
  'order id', 'order date', 'product name', 'title', 'asin', 'asin isbn', 'quantity', 'original quantity',
  'unit price', 'purchase price per unit', 'unit price tax', 'shipment item subtotal tax', 'item subtotal tax',
  'shipping charge', 'total discounts', 'total owed', 'item total', 'order status',
  'carrier name tracking number', 'payment instrument type', 'currency', 'shipment status',
]);
const headerKey = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Keeps only KEEP_COLUMNS. A file without a single known column is sent as is,
// so the server can say what's wrong with it.
export function trimOrderCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return '';
  const keep = rows[0].map((h, i) => (KEEP_COLUMNS.has(headerKey(h)) ? i : -1)).filter((i) => i >= 0);
  if (!keep.length) return text;
  return rows.map((r) => keep.map((i) => csvCell(r[i] ?? '')).join(',')).join('\n');
}

export const AMAZON_HOW_TO = 'On Amazon, open Account > Request Your Data, choose "Your Orders" and submit. Amazon emails a download link (usually within a few hours). Unzip it and choose Retail.OrderHistory.1.csv.';

const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const readText = (file) => (typeof file.text === 'function'
  ? file.text()
  : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  }));

// ─── Files we don't recognize: the user matches the columns ────────────────
// Each detail the server reads, the Amazon column name it goes up under, and
// the column names other exports commonly use for it (first guesses).
export const ORDER_FIELDS = [
  { key: 'orderId', label: 'Order number', header: 'Order ID', required: true, aliases: ['order id', 'order number', 'order no', 'order', 'orderid', 'order num', 'confirmation number'] },
  { key: 'orderDate', label: 'Order date', header: 'Order Date', hint: 'Needed to match by name and date', aliases: ['order date', 'date', 'purchase date', 'ordered', 'order placed', 'date ordered'] },
  { key: 'name', label: 'Item name', header: 'Product Name', required: true, aliases: ['product name', 'title', 'item', 'item name', 'product', 'description', 'item description'] },
  { key: 'qty', label: 'Quantity', header: 'Quantity', required: true, aliases: ['quantity', 'qty', 'original quantity', 'units', 'count'] },
  { key: 'unitPrice', label: 'Price per unit', header: 'Unit Price', required: true, aliases: ['unit price', 'price', 'item price', 'purchase price per unit', 'unit cost', 'cost', 'price each'] },
  { key: 'tax', label: 'Tax for the line', header: 'Shipment Item Subtotal Tax', aliases: ['tax', 'sales tax', 'item tax', 'item subtotal tax', 'tax amount'] },
  { key: 'shipping', label: 'Shipping', header: 'Shipping Charge', aliases: ['shipping', 'shipping charge', 'shipping cost', 'shipping fee', 'delivery'] },
  { key: 'discount', label: 'Discount', header: 'Total Discounts', aliases: ['discount', 'discounts', 'total discounts', 'promotion', 'savings'] },
  { key: 'tracking', label: 'Tracking number', header: 'Carrier Name & Tracking Number', aliases: ['tracking', 'tracking number', 'tracking numbers', 'carrier name tracking number', 'tracking id'] },
  { key: 'payment', label: 'Card or payment', header: 'Payment Instrument Type', aliases: ['payment', 'payment method', 'payment instrument type', 'card', 'paid with'] },
  { key: 'status', label: 'Order status', header: 'Order Status', aliases: ['status', 'order status', 'item status'] },
];

// Amazon's own export, under either of its two layouts.
const recognized = (keys) => keys.has('order id')
  && (keys.has('product name') || keys.has('title'))
  && (keys.has('unit price') || keys.has('purchase price per unit'))
  && (keys.has('quantity') || keys.has('original quantity'));

// First guess for each field: the first column whose name is one of its aliases.
export function guessOrderColumns(headers) {
  const keys = headers.map(headerKey);
  const taken = new Set();
  return Object.fromEntries(ORDER_FIELDS.map((f) => {
    const i = f.aliases.map((a) => keys.indexOf(a)).find((n) => n >= 0 && !taken.has(n));
    if (i === undefined) return [f.key, ''];
    taken.add(i);
    return [f.key, String(i)];
  }));
}

export const missingOrderColumns = (mapping) => ORDER_FIELDS.filter((f) => f.required && mapping[f.key] === '');

// Rewrites a file under the column names the server reads, keeping only the
// matched columns (so nothing else leaves the browser).
export function applyOrderColumns(text, mapping) {
  const rows = parseCsv(text);
  const used = ORDER_FIELDS.filter((f) => mapping[f.key] !== '' && mapping[f.key] !== undefined);
  return [
    used.map((f) => csvCell(f.header)).join(','),
    ...rows.slice(1).map((r) => used.map((f) => csvCell(r[Number(mapping[f.key])] ?? '')).join(',')),
  ].join('\n');
}

const checkUploadSize = (csv) => {
  if (new Blob([csv]).size > MAX_UPLOAD_BYTES) {
    throw new Error('That order history is too long to read at once. Split the CSV into smaller files (by year) and add each one.');
  }
  return csv;
};

// Reads a chosen order export. An Amazon export comes back trimmed for upload
// as { csv }. Any other file comes back as { mapping } (its column names, five
// sample rows and first guesses) for the user to match its columns, then
// finishOrderMapping() turns it into { csv }. Throws a message the user can act on.
export async function readOrderFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too big to read here.');
  const text = await readText(file);
  const rows = parseCsv(text);
  if (!rows.length || !rows[0].some((h) => String(h).trim())) throw new Error('That file is empty.');
  const headers = rows[0].map((h) => String(h).trim());
  if (recognized(new Set(headers.map(headerKey)))) return { csv: checkUploadSize(trimOrderCsv(text)) };
  if (rows.length < 2) throw new Error('That file has no order rows.');
  return { mapping: { name: file.name, text, headers, sample: rows.slice(1, 6), guess: guessOrderColumns(headers) } };
}

export function finishOrderMapping(mapping, columns) {
  const missing = missingOrderColumns(columns);
  if (missing.length) throw new Error(`Pick the column for ${missing.map((f) => f.label.toLowerCase()).join(', ')}.`);
  return checkUploadSize(applyOrderColumns(mapping.text, columns));
}

// Several files go up in one request, so together they share the limit.
export const MAX_ORDER_FILES = 10;
export const orderFilesTooBig = (files) => new Blob(files.map((f) => f.csv)).size > MAX_UPLOAD_BYTES;

// The logins saved under the user's Amazon store(s) (Data Setup > Accounts),
// for tagging which account an order file came from.
export function storeAccountChoices(platforms, match = /amazon/i) {
  const stores = (platforms || []).filter((p) => p.type === 'Vendor' && match.test(p.name || ''));
  return stores.flatMap((s) => (s.accounts || []).map((a) => ({
    id: a.id,
    vendorId: s.id,
    label: stores.length > 1 ? `${accountLabel(a)} · ${s.name}` : accountLabel(a),
  })));
}

// The logins for one store (a file from another store, its columns matched
// by the user), or the Amazon ones when no store is named.
export function fileAccountChoices(platforms, storeId) {
  if (!storeId) return storeAccountChoices(platforms);
  const store = (platforms || []).find((p) => p.id === storeId);
  return (store?.accounts || []).map((a) => ({ id: a.id, vendorId: store.id, label: accountLabel(a) }));
}

// The store a file's name points to ("bestbuy-orders.csv" -> Best Buy).
export function guessStoreId(fileName, stores) {
  const squash = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const name = squash(fileName);
  const hit = (stores || []).filter((st) => squash(st.name).length >= 3 && name.includes(squash(st.name)))
    .sort((a, b) => squash(b.name).length - squash(a.name).length)[0];
  return hit?.id || '';
}

// A newly added file starts on the only account there is; with several, the
// user picks (most exports are one account's whole history).
export const defaultFileAccount = (accounts) => (accounts.length === 1 ? accounts[0].id : '');
