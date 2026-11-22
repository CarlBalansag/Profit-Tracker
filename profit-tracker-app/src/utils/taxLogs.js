// Shared bits for the mileage log, equipment list and home office forms on
// the Schedule C worksheet.
export const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
export const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none disabled:opacity-60';
export const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const isMoney = (v) => /^\d+(\.\d{1,2})?$/.test(String(v).trim());
export const isMiles = (v) => /^\d+(\.\d)?$/.test(String(v).trim());
export const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const todayIn = (year) => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return today.startsWith(String(year)) ? today : `${year}-01-01`;
};

export const ASSET_METHODS = {
  de_minimis: { label: 'Deduct in full (de minimis, up to $2,500 an item)', short: 'De minimis', line: '22' },
  section_179: { label: 'Deduct in full (Section 179)', short: 'Section 179', line: '13' },
  macrs: { label: 'Depreciate over several years', short: 'Depreciation', line: '13' },
};
