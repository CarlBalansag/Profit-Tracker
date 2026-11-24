import { describe, expect, it } from 'vitest';
import { buildInvoicePdf, invoiceFileName, invoiceNumberLabel, textWidth, wrapText } from './invoicePdf';

const invoice = (extra = {}) => ({
  number: 7,
  buyer_name: 'Wholesale Co',
  issue_date: '2026-11-10',
  due_date: '2026-11-24',
  status: 'SENT',
  overdue: false,
  notes: null,
  subtotal: 739.99,
  tax: 8.25,
  total: 748.24,
  lines: [
    { description: 'PS5 Pro', quantity: 3, unit_price: 33.33, amount: 99.99, sale_date: '2026-11-03' },
    { description: 'iPad Air', quantity: 1, unit_price: 640, amount: 640, sale_date: '2026-11-05' },
  ],
  ...extra,
});

const text = (bytes) => String.fromCharCode(...bytes);

// Every object the cross-reference table points at must start where it says.
function checkStructure(file) {
  expect(file.startsWith('%PDF-1.4\n')).toBe(true);
  expect(file.endsWith('%%EOF\n')).toBe(true);
  const start = Number(file.match(/startxref\n(\d+)\n%%EOF/)[1]);
  expect(file.slice(start, start + 4)).toBe('xref');
  const rows = [...file.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((match) => Number(match[1]));
  rows.forEach((offset, index) => expect(file.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`));
  expect(Number(file.match(/\/Size (\d+)/)[1])).toBe(rows.length + 1);
  for (const match of file.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(match[2].length).toBe(Number(match[1]));
  return rows.length;
}

describe('buildInvoicePdf', () => {
  it('makes a well-formed one-page PDF with the number, parties, lines and totals', () => {
    const file = text(buildInvoicePdf(invoice(), { from: 'Carl Resells' }));
    expect(checkStructure(file)).toBe(6);
    expect(file).toContain('/Count 1');
    for (const piece of ['(INVOICE)', '(#0007)', '(Carl Resells)', '(Wholesale Co)', '(Nov 10, 2026)', '(Nov 24, 2026)', '(Unpaid)', '(PS5 Pro)', '($33.33)', '($99.99)', '($640.00)', '(Subtotal)', '($739.99)', '(Sales tax)', '($8.25)', '(Total due)', '($748.24)']) {
      expect(file).toContain(piece);
    }
  });

  it('leaves out the tax rows with no tax, and says Overdue, Paid or Draft', () => {
    const noTax = text(buildInvoicePdf(invoice({ tax: 0, subtotal: 739.99, total: 739.99 })));
    expect(noTax).not.toContain('(Sales tax)');
    expect(noTax).not.toContain('(Subtotal)');
    expect(noTax).toContain('(Seller)');
    expect(text(buildInvoicePdf(invoice({ overdue: true })))).toContain('(Overdue)');
    expect(text(buildInvoicePdf(invoice({ status: 'PAID' })))).toContain('(Paid)');
    expect(text(buildInvoicePdf(invoice({ status: 'DRAFT', number: null })))).toContain('(Draft)');
  });

  it('runs onto more pages for a long invoice and keeps every line', () => {
    const lines = Array.from({ length: 90 }, (_, index) => ({ description: `Item ${index + 1}`, quantity: 1, unit_price: 10, amount: 10, sale_date: '2026-11-01' }));
    const file = text(buildInvoicePdf(invoice({ lines, tax: 0, subtotal: 900, total: 900, notes: 'Thanks' })));
    const objects = checkStructure(file);
    const pages = Number(file.match(/\/Count (\d+)/)[1]);
    expect(pages).toBeGreaterThan(1);
    expect(objects).toBe(4 + pages * 2);
    expect(file).toContain('(Item 1)');
    expect(file).toContain('(Item 90)');
    expect(file).toContain(`(Page ${pages} of ${pages})`);
    expect(file).toContain('(Invoice #0007 \\(continued\\))');
  });

  it('escapes brackets and backslashes, keeps accents, replaces what the font cannot print, and cuts long names', () => {
    const file = text(buildInvoicePdf(invoice({
      buyer_name: 'Café (West) \\ Co',
      notes: 'Pay by wire — 日本\nSecond line',
      lines: [{ description: `Very long product name ${'x'.repeat(200)}`, quantity: 2, unit_price: 5, amount: 10, sale_date: '2026-11-01' }],
    })));
    checkStructure(file);
    expect(file).toContain('(Caf\\351 \\(West\\) \\\\ Co)');
    expect(file).toContain('(Pay by wire ? ??)');
    expect(file).toContain('(Second line)');
    expect(file).toMatch(/\(Very long product name x+\.\.\.\)/);
    // Plain ASCII throughout, so byte offsets equal character offsets.
    expect([...file].every((char) => char.charCodeAt(0) < 128)).toBe(true);
  });

  it('builds with no lines or notes at all', () => {
    const file = text(buildInvoicePdf(invoice({ lines: [], tax: 0, subtotal: 0, total: 0 })));
    checkStructure(file);
    expect(file).toContain('($0.00)');
  });
});

describe('text helpers', () => {
  it('measures digits and money punctuation exactly, so amounts line up', () => {
    expect(textWidth('0', 10)).toBeCloseTo(5.56);
    expect(textWidth('$1,234.50', 10)).toBeCloseTo((556 * 7 + 278 * 2) / 100);
    expect(textWidth('$1,234.50', 10, true)).toBeCloseTo(textWidth('$1,234.50', 10));
  });

  it('wraps notes to the width and keeps blank-free lines', () => {
    const lines = wrapText('one two three four five six seven eight nine ten', 10, 60);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => textWidth(line, 10) <= 60)).toBe(true);
    expect(lines.join(' ')).toBe('one two three four five six seven eight nine ten');
  });

  it('names the file and the number', () => {
    expect(invoiceNumberLabel({ number: 12 })).toBe('#0012');
    expect(invoiceNumberLabel({ number: null })).toBe('Draft');
    expect(invoiceFileName({ number: 12, buyer_name: 'Wholesale Co.' })).toBe('invoice-0012-Wholesale-Co.pdf');
    expect(invoiceFileName({ number: null, buyer_name: '' })).toBe('invoice-draft.pdf');
  });
});
