import Decimal from 'decimal.js';
import { moneyKeys, rateKeys } from '../../../shared/currencyContract.mjs';

function currencyJSON(input) {
  if (Array.isArray(input)) return input.map(currencyJSON);
  if (!input || typeof input !== 'object') return input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key,
    (moneyKeys.has(key) || rateKeys.has(key)) && value != null && !(key.startsWith('target_') && input.metric === 'unitsSold')
      ? new Decimal(value).toFixed(rateKeys.has(key) ? 6 : 2) : currencyJSON(value)]));
}

export function csvText(records) {
  if (!records.length) return '';
  const keys = Object.keys(records[0]);
  const cell = (value, key) => {
    let text = value == null ? '' : String(value);
    const numericCurrency = (moneyKeys.has(key) || rateKeys.has(key)) && /^-?\d+(?:\.\d+)?$/.test(text);
    if (numericCurrency) text = new Decimal(text).toFixed(rateKeys.has(key) ? 6 : 2);
    if (!numericCurrency && typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [keys, ...records.map(row => keys.map(key => row[key]))]
    .map((row, index) => row.map((value, column) => cell(value, index ? keys[column] : null)).join(',')).join('\r\n');
}

export function downloadFile(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJSON(name, data) {
  downloadFile(name, JSON.stringify(currencyJSON(data), null, 2));
}

export function shareCard(stats, mode, period) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  const money = value => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="540" viewBox="0 0 1000 540"><rect width="1000" height="540" rx="24" fill="#12121a"/><g fill="#eeeeee" font-family="sans-serif"><text x="60" y="90" font-size="40">Selvora</text><text x="60" y="145" font-size="24">${escape(mode)} · ${escape(period)}</text><text x="60" y="245" font-size="26">Revenue: ${escape(money(stats.totalRevenue))}</text><text x="60" y="315" font-size="26">Realized profit: ${escape(money(stats.profit))}</text><text x="60" y="385" font-size="26">Inventory value: ${escape(money(stats.inventoryValue))}</text><text x="60" y="470" font-size="18">Generated ${escape(new Date().toISOString().slice(0, 10))} · USD</text></g></svg>`;
}
