// Pulls the store, the total and the date out of text read from a receipt.
// Receipts vary a lot and on-device text recognition makes mistakes, so every
// value is only a suggestion the person checks before saving.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONEY = /(?:\$\s*)?(\d{1,6}(?:,\d{3})*[.,]\d{2})(?!\d)/g;
const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function findDate(text) {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) { const d = validDate(+m[1], +m[2], +m[3]); if (d) return d; }
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) { const d = validDate(+m[3], +m[1], +m[2]); if (d) return d; }
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m) { const d = validDate(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]); if (d) return d; }
  return null;
}

const amountsIn = (line) => [...line.matchAll(MONEY)].map((x) => Number(x[1].replace(/,(?=\d{3})/g, '').replace(',', '.')));

function findTotal(lines) {
  // The last line that says "total" (but not subtotal), "amount due" or
  // "balance due", taking the last amount on it.
  const totalLine = /\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total)\b/i;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!totalLine.test(line) || /sub\s*-?\s*total|total\s+(savings|saved|items?|discount)/i.test(line)) continue;
    const amounts = amountsIn(line).length ? amountsIn(line) : amountsIn(lines[i + 1] || '');
    if (amounts.length) return amounts[amounts.length - 1];
  }
  // Otherwise the largest amount on the receipt.
  const all = lines.flatMap(amountsIn);
  return all.length ? Math.max(...all) : null;
}

function findMerchant(lines) {
  const skip = /\b(receipt|welcome|thank|invoice|order|store\s*#|tel|phone|www\.|http)/i;
  for (const line of lines.slice(0, 6)) {
    const letters = (line.match(/[a-z]/gi) || []).length;
    if (letters >= 3 && letters >= line.replace(/\s/g, '').length * 0.6 && !skip.test(line)) return line.replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  return null;
}

/** { merchant, total: '12.34', date: 'YYYY-MM-DD' } with null for anything not found. */
export function parseReceiptText(text = '') {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const total = findTotal(lines);
  return {
    merchant: findMerchant(lines),
    total: total != null && total > 0 ? total.toFixed(2) : null,
    date: findDate(lines.join('\n')),
  };
}
