// Reads the text of a receipt image on this device with Tesseract.js (free,
// open source, Apache-2.0). The image never leaves the browser: only the
// reader itself (its program and English language data) is downloaded from a
// public code CDN the first time, which is why it only runs when asked.
import { parseReceiptText } from './receiptText';

export const READABLE_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function readReceiptOnDevice(file, onProgress = () => {}) {
  if (!READABLE_RECEIPT_TYPES.has(file?.type)) throw new Error('Only photos and images of receipts can be read (not PDFs).');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.round((m.progress || 0) * 100)); },
  });
  try {
    const { data } = await worker.recognize(file);
    return { ...parseReceiptText(data.text), text: data.text };
  } finally {
    await worker.terminate();
  }
}
