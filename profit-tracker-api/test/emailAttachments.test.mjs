// E6: text read out of PDF invoices fills what the email body lacked.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { makePdf, mimeWithPdf } from './fixtures/emails.mjs';

const require = createRequire(import.meta.url);
const { pdfText, mergePdfDetails, firstPdf } = require('../services/email/attachments.js');
const { parseSource, extractEmail } = require('../services/email/extract/index.js');

const invoice = makePdf(['Pirate Ship Invoice', 'Order Number: PS-1234567', 'Subtotal: $14.37', 'Order Total: $14.37', 'Paid with Visa ending in 4242']);

describe('PDF invoices', () => {
  it('reads the text of a PDF line by line', async () => {
    const text = await pdfText(invoice);
    expect(text.split('\n')).toEqual(expect.arrayContaining(['Order Total: $14.37', 'Paid with Visa ending in 4242']));
  });

  it('fills only what the email body did not have, a little less trusted, and names the parser', async () => {
    const raw = mimeWithPdf({ from: 'support@pirateship.com', subject: 'Your Pirate Ship receipt', html: '<p>Thanks! Your receipt is attached.</p>', pdf: invoice });
    const parsed = await parseSource(raw);
    const pdf = firstPdf(parsed.attachments);
    expect(pdf.filename).toBe('invoice.pdf');
    const body = extractEmail({ merchant: 'pirateship', ...parsed });
    expect(body.total).toBe(null);
    const merged = mergePdfDetails(body, extractEmail({ merchant: 'pirateship', subject: parsed.subject, text: await pdfText(pdf.content) }));
    expect(merged).toMatchObject({ kind: 'receipt', total: '14.37', payment_hint: 'Visa 4242', order_number: 'PS-1234567' });
    expect(merged.confidence.total).toBeLessThan(0.6);
    expect(merged.parser).toMatch(/\+ pdf$/);

    const kept = mergePdfDetails({ ...body, total: '99.00', confidence: { total: 0.6 } }, { total: '14.37' });
    expect(kept.total).toBe('99.00');
  });

  it('gives up quietly on a broken PDF', async () => {
    await expect(pdfText(Buffer.from('%PDF-1.4 not really'))).rejects.toBeTruthy();
    expect(firstPdf([{ filename: 'photo.png', contentType: 'image/png', content: Buffer.from('x') }])).toBe(null);
  });
});
