import { formatMoney } from './money';

// Builds an invoice as a PDF file, in the browser, with no PDF library: a
// plain text-and-lines document in the two built-in Helvetica fonts. Returns
// the file's bytes (Uint8Array). Letter size, as many pages as the lines need.

const PAGE = { width: 612, height: 792, margin: 54 };
const ROW = 18;

// Helvetica's character widths (per 1000 units of font size) for ASCII 32-126,
// used to right-align amounts and to cut or wrap text that is too long.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// The PDF's fonts hold Latin-1 only. Typed punctuation phones and word
// processors put in (curly quotes, long dashes) goes in as its plain form;
// anything else prints as "?".
const PLAIN = {
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u2032': "'", '\u2033': '"',
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2212': '-',
  '\u2022': '-', '\u2026': '...', '\u2122': '(TM)', '\u00A0': ' ', '\u2009': ' ', '\u202F': ' ', '\t': ' ', '\r': '', '\u200B': '', '\uFE0F': '',
};
const inFont = (code) => (code >= 32 && code <= 126) || (code >= 160 && code <= 255);
const printable = (text) => [...String(text ?? '').normalize('NFC')]
  .map((char) => PLAIN[char] ?? (char === '\n' || (char.length === 1 && inFont(char.charCodeAt(0))) ? char : '?')).join('');

export function textWidth(text, size, bold = false) {
  let units = 0;
  for (const char of printable(text)) {
    const code = char.charCodeAt(0);
    units += code >= 32 && code <= 126 ? WIDTHS[code - 32] : 556;
  }
  // Bold letters run a little wider; digits and money punctuation don't.
  const widen = bold && /[A-Za-z]/.test(text) ? 1.06 : 1;
  return (units * size * widen) / 1000;
}

function fit(text, size, maxWidth, bold = false) {
  const clean = printable(text).replace(/\n/g, ' ');
  if (textWidth(clean, size, bold) <= maxWidth) return clean;
  let cut = clean;
  while (cut.length > 1 && textWidth(`${cut}...`, size, bold) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

export function wrapText(text, size, maxWidth) {
  const lines = [];
  for (const paragraph of printable(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size) <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines.map((line) => fit(line, size, maxWidth));
}

// Text inside a PDF string: ( ) and \ are escaped, Latin-1 letters go in as
// octal codes so the whole file stays plain ASCII.
const pdfString = (text) => `(${[...printable(text)].map((char) => {
  const code = char.charCodeAt(0);
  if (char === '(' || char === ')' || char === '\\') return `\\${char}`;
  return code > 126 ? `\\${code.toString(8).padStart(3, '0')}` : char;
}).join('')})`;

const money = (value) => {
  const number = Number(value) || 0;
  return `${number < 0 ? '-' : ''}$${formatMoney(Math.abs(number))}`;
};

const longDate = (day) => {
  if (!day) return '';
  const [year, month, date] = String(day).slice(0, 10).split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[month - 1] ? `${names[month - 1]} ${date}, ${year}` : String(day);
};

export const invoiceNumberLabel = (invoice) => (invoice?.number ? `#${String(invoice.number).padStart(4, '0')}` : 'Draft');

export const invoiceFileName = (invoice) => {
  const buyer = String(invoice?.buyer_name || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const number = invoice?.number ? String(invoice.number).padStart(4, '0') : 'draft';
  return `invoice-${number}${buyer ? `-${buyer}` : ''}.pdf`;
};

const STATUS_LABELS = { DRAFT: 'Draft', SENT: 'Unpaid', PAID: 'Paid', CANCELLED: 'Cancelled' };

// One page's drawing commands.
function pageWriter() {
  const ops = [];
  const y = (top) => (PAGE.height - top).toFixed(2);
  return {
    ops,
    text(value, x, top, { size = 10, bold = false, align = 'left', gray = 0 } = {}) {
      const width = textWidth(value, size, bold);
      const left = align === 'right' ? x - width : x;
      ops.push(`${gray} g BT /${bold ? 'F2' : 'F1'} ${size} Tf ${left.toFixed(2)} ${y(top)} Td ${pdfString(value)} Tj ET`);
    },
    rule(top, { gray = 0.8, from = PAGE.margin, to = PAGE.width - PAGE.margin } = {}) {
      ops.push(`${gray} G 0.75 w ${from.toFixed(2)} ${y(top)} m ${to.toFixed(2)} ${y(top)} l S`);
    },
  };
}

export function buildInvoicePdf(invoice, { from = '' } = {}) {
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const columns = { date: left, description: left + 70, quantity: right - 190, unitPrice: right - 95, amount: right };
  const descriptionWidth = columns.quantity - 40 - columns.description;
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const noteLines = invoice.notes ? wrapText(invoice.notes, 10, right - left) : [];
  const bottom = PAGE.height - PAGE.margin;
  const pages = [];
  let page;
  let top;

  const tableHeader = () => {
    page.text('Date', columns.date, top, { size: 9, bold: true, gray: 0.35 });
    page.text('Description', columns.description, top, { size: 9, bold: true, gray: 0.35 });
    page.text('Qty', columns.quantity, top, { size: 9, bold: true, gray: 0.35, align: 'right' });
    page.text('Unit price', columns.unitPrice, top, { size: 9, bold: true, gray: 0.35, align: 'right' });
    page.text('Amount', columns.amount, top, { size: 9, bold: true, gray: 0.35, align: 'right' });
    top += 7;
    page.rule(top, { gray: 0.6 });
    top += ROW;
  };
  const newPage = (continued) => {
    page = pageWriter();
    pages.push(page);
    top = PAGE.margin + 10;
    if (continued) {
      page.text(`Invoice ${invoiceNumberLabel(invoice)} (continued)`, left, top, { size: 10, gray: 0.35 });
      top += 26;
      tableHeader();
    }
  };
  const need = (height, { table = true } = {}) => {
    if (top + height <= bottom) return;
    newPage(table);
  };

  // Heading: who it is from and to, the number, dates and status.
  newPage(false);
  page.text('INVOICE', left, top + 12, { size: 24, bold: true });
  page.text(invoiceNumberLabel(invoice), right, top + 12, { size: 16, bold: true, align: 'right' });
  top += 44;
  page.text('From', left, top, { size: 9, bold: true, gray: 0.35 });
  page.text('Bill to', left + 220, top, { size: 9, bold: true, gray: 0.35 });
  top += 15;
  page.text(fit(from || 'Seller', 11, 200), left, top, { size: 11 });
  page.text(fit(invoice.buyer_name || 'Buyer', 11, 190), left + 220, top, { size: 11 });
  const facts = [
    ['Invoice date', longDate(invoice.issue_date)],
    ['Due date', longDate(invoice.due_date)],
    ['Status', invoice.overdue ? 'Overdue' : STATUS_LABELS[invoice.status] || String(invoice.status || '')],
  ];
  facts.forEach(([label, value], index) => {
    const row = top - 15 + index * 15;
    page.text(label, right - 90, row, { size: 9, gray: 0.35, align: 'right' });
    page.text(value, right, row, { size: 10, align: 'right' });
  });
  top += 48;
  tableHeader();

  for (const line of lines) {
    need(ROW);
    page.text(longDate(line.sale_date), columns.date, top, { size: 9, gray: 0.35 });
    page.text(fit(line.description, 10, descriptionWidth), columns.description, top, { size: 10 });
    page.text(String(line.quantity ?? ''), columns.quantity, top, { size: 10, align: 'right' });
    page.text(money(line.unit_price), columns.unitPrice, top, { size: 10, align: 'right' });
    page.text(money(line.amount), columns.amount, top, { size: 10, align: 'right' });
    top += ROW;
  }

  // Totals stay together on one page.
  const hasTax = Number(invoice.tax) > 0;
  need(26 + ROW * (hasTax ? 3 : 1), { table: false });
  top -= 8;
  page.rule(top, { gray: 0.6 });
  top += 20;
  if (hasTax) {
    page.text('Subtotal', columns.unitPrice, top, { size: 10, gray: 0.35, align: 'right' });
    page.text(money(invoice.subtotal), columns.amount, top, { size: 10, align: 'right' });
    top += ROW;
    page.text('Sales tax', columns.unitPrice, top, { size: 10, gray: 0.35, align: 'right' });
    page.text(money(invoice.tax), columns.amount, top, { size: 10, align: 'right' });
    top += ROW;
  }
  page.text('Total due', columns.unitPrice, top, { size: 12, bold: true, align: 'right' });
  page.text(money(invoice.total), columns.amount, top, { size: 12, bold: true, align: 'right' });
  top += 34;

  if (noteLines.length) {
    need(30, { table: false });
    page.text('Notes', left, top, { size: 9, bold: true, gray: 0.35 });
    top += 15;
    for (const noteLine of noteLines) {
      need(14, { table: false });
      page.text(noteLine, left, top, { size: 10 });
      top += 14;
    }
  }

  pages.forEach((entry, index) => {
    if (pages.length > 1) entry.text(`Page ${index + 1} of ${pages.length}`, right, PAGE.height - 30, { size: 8, gray: 0.5, align: 'right' });
  });

  // The file: catalog, page tree, two fonts, then a page and its drawing for
  // each page, a table of where each object starts, and the trailer.
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  pages.forEach((entry, index) => {
    const stream = entry.ops.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let file = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  file += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Every character above is ASCII, so one byte each.
  const bytes = new Uint8Array(file.length);
  for (let index = 0; index < file.length; index += 1) bytes[index] = file.charCodeAt(index) & 0x7f;
  return bytes;
}
