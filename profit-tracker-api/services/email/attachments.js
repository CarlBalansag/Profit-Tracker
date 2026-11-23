// PDF invoices attached to store emails (E6).
//   pdfText          reads the text out of a PDF on the server (pdf.js, no
//                    scripts run, at most a few pages); nothing is sent anywhere
//   saveInvoice      fetches the email again and stores its PDF as the linked
//                    record's private receipt (Cloudinary "authenticated")
// The PDF itself is never kept with the email details.
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 5;
const MAX_TEXT = 200 * 1024;

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs')).href;
  }
  return pdfjs;
}

const isPdf = (a) => a && a.content && (/pdf/i.test(a.contentType || '') || /\.pdf$/i.test(a.filename || ''));
const firstPdf = (attachments = []) => attachments.find((a) => isPdf(a) && a.content.length <= MAX_PDF_BYTES) || null;

// Lines of text, in reading order, from the first few pages.
async function pdfText(buffer) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, stopAtErrors: false, verbosity: 0,
  });
  const lines = [];
  let doc;
  try {
    doc = await task.promise;
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Group text pieces by their baseline so a label and its amount on the
      // same row read as one line.
      const rows = new Map();
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        rows.set(y, [...(rows.get(y) || []), { x: item.transform[4], s: item.str }]);
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        lines.push(rows.get(y).sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join('  '));
      }
    }
  } finally {
    await task.destroy();
  }
  return lines.join('\n').slice(0, MAX_TEXT);
}

// Fills what the email body didn't have from its PDF, a little less trusted.
const FIELDS = ['order_number', 'total', 'subtotal', 'tax', 'shipping', 'discount', 'payment_hint'];
function mergePdfDetails(details, fromPdf) {
  const out = { ...details, confidence: { ...(details.confidence || {}) } };
  let used = false;
  for (const f of FIELDS) {
    if ((out[f] == null || out[f] === '') && fromPdf[f] != null && fromPdf[f] !== '') {
      out[f] = fromPdf[f];
      out.confidence[f] = Math.round((fromPdf.confidence?.[f] ?? 0.6) * 0.9 * 100) / 100;
      used = true;
    }
  }
  if ((!out.items || !out.items.length) && fromPdf.items?.length) { out.items = fromPdf.items; out.confidence.items = 0.4; used = true; }
  if (!out.tracking_numbers?.length && fromPdf.tracking_numbers?.length) { out.tracking_numbers = fromPdf.tracking_numbers; used = true; }
  if (out.status === 'ignored' && (out.order_number || out.total)) { out.status = 'extracted'; if (out.kind === 'other') out.kind = 'receipt'; used = true; }
  if (used) out.parser = `${out.parser} + pdf`;
  return out;
}

// Stores the order's PDF invoice as the receipt of the record it is linked to
// (expense, or the first purchase of the order). Never replaces a receipt.
async function saveInvoice(prisma, userId, orderId, { openClient, cloudinary }) {
  const order = await prisma.emailOrder.findFirst({
    where: { id: orderId, user_id: userId },
    include: { matches: { where: { state: 'linked' } }, messages: { where: { attachment_name: { not: null } }, orderBy: { sent_at: 'asc' }, include: { account: true } } },
  });
  if (!order) return { status: 404, error: 'Order not found.' };
  const match = order.matches[0];
  if (!match) return { status: 409, error: 'Link this order to a record first.' };
  const message = order.messages[0];
  if (!message) return { status: 404, error: 'This order has no PDF invoice.' };
  if (!message.account || message.account.status === 'disconnected' || !message.account.encrypted_secret) {
    return { status: 409, error: 'Connect the email account again to fetch the invoice.' };
  }
  const itemType = match.record_type === 'expense' ? 'expense' : match.record_type === 'purchase' ? 'inventory' : null;
  if (!itemType) return { status: 400, error: 'Invoices can be saved on purchases and expenses.' };
  const itemId = match.record_ids[0];
  const model = itemType === 'expense' ? prisma.expense : prisma.inventory;
  const record = await model.findFirst({ where: { id: itemId, user_id: userId } });
  if (!record) return { status: 404, error: 'The linked record no longer exists.' };
  if (record.receipt_url) return { status: 409, error: 'This record already has a receipt.' };

  const client = await openClient(message.account);
  let pdf;
  try {
    await client.openReadOnly(message.folder);
    const uid = await client.findUidByMessageId(message.message_id) || message.uid;
    const [source] = await client.fetchSources([uid], { maxLength: MAX_PDF_BYTES + 512 * 1024 });
    if (!source) return { status: 404, error: 'This email is no longer in the mailbox.' };
    const { parseSource } = require('./extract');
    pdf = firstPdf((await parseSource(source.source, { maxBytes: MAX_PDF_BYTES + 512 * 1024 })).attachments);
  } finally {
    await client.close();
  }
  if (!pdf) return { status: 404, error: 'The PDF could not be read from the email.' };

  const upload = await cloudinary.uploader.upload(`data:application/pdf;base64,${pdf.content.toString('base64')}`, {
    folder: 'profittracker/receipts', resource_type: 'auto', type: 'authenticated',
    public_id: `${itemType}_${itemId}_${randomUUID()}`, overwrite: false,
  });
  const { privateRef } = require('../privateReceipts');
  const ref = privateRef({ resourceType: upload.resource_type, format: upload.format, publicId: upload.public_id });
  // Only fills an empty receipt; a receipt added meanwhile wins.
  const saved = await model.updateMany({ where: { id: itemId, user_id: userId, receipt_url: null }, data: { receipt_url: ref } });
  if (!saved.count) {
    await cloudinary.uploader.destroy(upload.public_id, { resource_type: upload.resource_type || 'image', type: 'authenticated' }).catch(() => {});
    return { status: 409, error: 'This record already has a receipt.' };
  }
  return { status: 200, saved: true, record_type: match.record_type, record_id: itemId };
}

module.exports = { pdfText, mergePdfDetails, firstPdf, saveInvoice, MAX_PDF_BYTES };
