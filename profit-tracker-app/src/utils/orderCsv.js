// Store order exports (Settings > Data > Fill in costs from store orders).
// The columns the server reads (see AMAZON_COLUMNS in fillCosts.js). Everything
// else, like shipping and billing addresses, never leaves the browser, which
// also keeps years of order history under the upload limit.
const KEEP_COLUMNS = new Set([
  'order id', 'order date', 'product name', 'title', 'asin', 'asin isbn', 'quantity', 'original quantity',
  'unit price', 'purchase price per unit', 'unit price tax', 'shipment item subtotal tax', 'item subtotal tax',
  'shipping charge', 'total discounts', 'total owed', 'item total', 'order status',
  'carrier name tracking number', 'payment instrument type', 'currency',
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

// Reads a chosen order export and trims it for upload. Throws with a message
// the user can act on.
export async function readOrderFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is too big to read here.');
  const csv = trimOrderCsv(await readText(file));
  if (new Blob([csv]).size > MAX_UPLOAD_BYTES) {
    throw new Error('That order history is too long to read at once. Split the CSV into smaller files (by year) and import each one.');
  }
  return csv;
}
