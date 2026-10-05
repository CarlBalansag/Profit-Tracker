// Version history shown in the sidebar's "What's New" modal.
// Newest entry first. Whenever a feature, update, or fix ships, bump the
// version and add a short, non-technical entry here.
export const CHANGELOG = [
  {
    version: '0.53',
    date: '2026-10-04',
    notes: 'Purchases and sales that share a tracking number now show as one combined card on the Statuses page, which you can open to see each item.',
  },
  {
    version: '0.52',
    date: '2026-10-04',
    notes: 'The Shipping page now only lists purchases and sales that are actually on the way, instead of keeping everything forever.',
  },
  {
    version: '0.51',
    date: '2026-10-03',
    notes: 'Dashboard settings now explain each option, use accurate per-unit averages, and omit the duplicate Completed status.',
  },
  {
    version: '0.50',
    date: '2026-10-01',
    notes: 'Fixed the Expense form losing focus while typing in the Name or Amount fields.',
  },
];

export const CURRENT_VERSION = CHANGELOG[0].version;
