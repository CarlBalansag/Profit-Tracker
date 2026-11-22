// Cash-out receipts: the PDF a cash-out site sends once it has scanned in what
// was shipped to it and credited the user's balance. Read from the PDF's text
// (attachments.pdfText), one item per table row:
//
//   1  SAMSUNG-...-990-EVO [MZ-V9S1T0B/AM]  3  $154.99  $6.01  $483.00
//   887276843711                                   (UPC, own line or inline)
//   2  TBA TRACKING #: TBA336613941521
//   3  SERIALS: S7U5NU0YB48639; S7U5NU0YB48651
//
// PRICE and COMMISION are per unit; TOTAL is quantity x (price + commission).
// The customer block (name, address, email) is never read or kept.

const MONEY = String.raw`\$\s?([\d,]+\.\d{2})`;
// Columns may be split by one space or several (PDF text runs vary); the
// quantity is the number right before the three amounts.
const ITEM = new RegExp(String.raw`^\d{1,3}\s+(.+?)(?:\s+(\d{12,14}))?\s+(\d{1,4})\s+${MONEY}\s+${MONEY}\s+${MONEY}\s*$`);
const UPC = /^(\d{12,14})$/;
const TRACKING = /TRACKING\s*#?\s*:?\s*([A-Z0-9]{8,34})\b/i;
const SERIALS = /SERIALS?\s*:\s*(.+)$/i;
const TOTAL = new RegExp(String.raw`^TOTAL\s+\d+\s+(?:${MONEY}\s+)?${MONEY}\s*$`, 'i');
const CREATED = /Created:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

const amount = (s) => Number(String(s).replace(/,/g, ''));
const cents = (n) => Math.round(n * 100) / 100;

function readCashoutReceipt(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const items = [];
  let total = null;
  let receiptDate = null;
  for (const line of lines) {
    const item = line.match(ITEM);
    if (item) {
      const [, name, upc, qty, price, commission, lineTotal] = item;
      items.push({
        name: name.replace(/-{2,}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
        upc: upc || null,
        quantity: Number(qty),
        unit_price: amount(price).toFixed(2),
        commission: amount(commission).toFixed(2),
        // What one unit pays: price plus its commission.
        unit_payout: cents(amount(price) + amount(commission)).toFixed(2),
        total: amount(lineTotal).toFixed(2),
        tracking: null,
        serials: [],
      });
      continue;
    }
    const last = items[items.length - 1];
    const upc = line.match(UPC);
    if (upc && last && !last.upc) { last.upc = upc[1]; continue; }
    const tracking = line.match(TRACKING);
    if (tracking && last && !last.tracking) { last.tracking = tracking[1].toUpperCase(); continue; }
    const serials = line.match(SERIALS);
    if (serials && last) {
      last.serials = serials[1].split(/[;,]/).map((s) => s.trim()).filter((s) => /^[A-Z0-9-]{4,40}$/i.test(s)).slice(0, 50);
      continue;
    }
    const sum = line.match(TOTAL);
    if (sum) { total = amount(sum[2]).toFixed(2); continue; }
    const created = line.match(CREATED);
    if (created && !receiptDate) receiptDate = `${created[3]}-${created[1].padStart(2, '0')}-${created[2].padStart(2, '0')}`;
  }
  if (!items.length) return null;
  if (total == null) total = cents(items.reduce((t, i) => t + Number(i.total), 0)).toFixed(2);
  return {
    items,
    total,
    tracking_numbers: [...new Set(items.map((i) => i.tracking).filter(Boolean))],
    receipt_date: receiptDate,
  };
}

module.exports = { readCashoutReceipt };
