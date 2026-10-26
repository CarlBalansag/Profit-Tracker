export function csvText(records) {
  if (!records.length) return '';
  const keys = Object.keys(records[0]);
  const cell = (value) => {
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
