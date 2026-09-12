import { apiFetch } from '../hooks/useApi';
import { batchCost, saleEconomics, isRealizedSale } from '../../../shared/finance.mjs';

export const exportCategories = [
  'Stores', 'Accounts', 'Payment Methods', 'Card-Store Rates', 'Expenses', 'Transactions', 'Inventory',
];
const paths = {
  Stores: ['platforms'], Accounts: ['accounts'], 'Payment Methods': ['payment-methods'],
  'Card-Store Rates': ['payment-methods'], Expenses: ['expenses', 'recurring-expenses'],
  Transactions: ['inventory'], Inventory: ['inventory'],
};

export async function exportSnapshot(selected, request = apiFetch) {
  if (!selected.length || selected.some(category => !paths[category])) throw new Error('Select available data to export.');
  const required = [...new Set(selected.flatMap(category => paths[category]))];
  const results = await Promise.all(required.map(async path => {
    const response = await request(`/api/${path}${path === 'recurring-expenses' ? '?export=true' : ''}`);
    if (!response.ok) throw new Error(`Could not export ${path} (${response.status}). No file was downloaded.`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error(`Invalid ${path} export response.`);
    return [path, data];
  }));
  const fetched = Object.fromEntries(results);
  const data = {};
  for (const category of selected) {
    if (category === 'Inventory') data[category] = fetched.inventory.filter(item => item.qty_on_hand > 0);
    else if (category === 'Expenses') data[category] = { expenses: fetched.expenses, recurring: fetched['recurring-expenses'] };
    else if (category === 'Card-Store Rates') data[category] = fetched['payment-methods'].map(method => ({ id: method.id, name: method.name, default_cashback_rate: method.default_cashback_rate, category_rates: method.category_rates }));
    else data[category] = fetched[paths[category][0]];
  }
  return { version: 1, generatedAt: new Date().toISOString(), currency: 'USD', data };
}

export function transactionExport(items) {
  return items.flatMap(item => [
    { type: 'Purchase', date: item.purchase_date, product: item.product_name, quantity: item.qty_purchased, cost: batchCost(item), revenue: null, profit: null, status: item.status },
    ...(item.sales || []).map(sale => {
      const economics = saleEconomics(item, sale);
      return { type: 'Sale', date: sale.sale_date, product: item.product_name, quantity: sale.quantity, cost: economics.cost, revenue: economics.revenue, profit: isRealizedSale(sale) ? economics.netProfit : 0, status: sale.status };
    }),
  ]);
}

export async function receiptArchive(snapshot, request = fetch) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('data.json', JSON.stringify(snapshot, null, 2));
  const purchases = [...(snapshot.data.Transactions || []), ...(snapshot.data.Inventory || [])];
  const expenses = snapshot.data.Expenses?.expenses || [];
  const receipts = new Map();
  for (const [kind, items] of [['purchase', purchases], ['expense', expenses]]) {
    for (const item of items) if (item.receipt_url) receipts.set(`${kind}-${item.id}`, item.receipt_url);
  }
  let totalBytes = 0;
  for (const [id, value] of receipts) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw new Error('A receipt has an unsupported storage URL. Export JSON instead.');
    const response = await request(url.href, { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('A receipt could not be downloaded. Retry or export JSON.');
    const declaredSize = Number(response.headers.get('content-length')) || 0;
    if (declaredSize + totalBytes > 50 * 1024 * 1024) throw new Error('Receipts exceed the 50 MB export limit. Export fewer categories.');
    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size + totalBytes > 50 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('Receipts exceed the 50 MB export limit. Export fewer categories.');
          }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    totalBytes += bytes.length;
    if (totalBytes > 50 * 1024 * 1024) throw new Error('Receipts exceed the 50 MB export limit. Export fewer categories.');
    const extension = ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[response.headers.get('content-type')?.split(';')[0]] || 'bin';
    zip.file(`receipts/${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`, bytes);
  }
  return zip.generateAsync({ type: 'uint8array' });
}
