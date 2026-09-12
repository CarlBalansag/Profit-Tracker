export function csvText(records) {
  if (!records.length) return '';
  const keys = Object.keys(records[0]);
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [keys, ...records.map(row => keys.map(key => row[key]))]
    .map(row => row.map(cell).join(',')).join('\r\n');
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
  downloadFile(name, JSON.stringify(data, null, 2));
}

export function shareCard(stats, mode, period) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  const money = value => Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="540" viewBox="0 0 1000 540"><rect width="1000" height="540" rx="24" fill="#12121a"/><g fill="#eeeeee" font-family="sans-serif"><text x="60" y="90" font-size="40">Selvora</text><text x="60" y="145" font-size="24">${escape(mode)} · ${escape(period)}</text><text x="60" y="245" font-size="26">Revenue: ${escape(money(stats.totalRevenue))}</text><text x="60" y="315" font-size="26">Realized profit: ${escape(money(stats.profit))}</text><text x="60" y="385" font-size="26">Inventory value: ${escape(money(stats.inventoryValue))}</text><text x="60" y="470" font-size="18">Generated ${escape(new Date().toISOString().slice(0, 10))} · USD</text></g></svg>`;
}
