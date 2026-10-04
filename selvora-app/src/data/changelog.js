// Version history shown in the sidebar's "What's New" modal.
// Newest entry first. Whenever a feature, update, or fix ships, bump the
// version and add a short, non-technical entry here.
export const CHANGELOG = [
  {
    version: '0.56',
    date: '2026-10-03',
    notes: 'Added a Completed section to the Statuses page listing every sale that has been paid.',
  },
  {
    version: '0.55',
    date: '2026-10-03',
    notes: 'Each column on the Statuses board now shows 15 items at a time with Previous/Next buttons instead of one long list.',
  },
  {
    version: '0.54',
    date: '2026-10-03',
    notes: 'Every card on the Statuses board now has a quick status dropdown, showing only the statuses that make sense for that purchase or sale.',
  },
  {
    version: '0.53',
    date: '2026-10-02',
    notes: 'Purchases and sales with no status yet can now be given one straight from the Statuses page.',
  },
  {
    version: '0.52',
    date: '2026-10-02',
    notes: 'The Statuses page is now a three-column board: incoming purchases, items on hand, and sales on their way out.',
  },
  {
    version: '0.51',
    date: '2026-10-02',
    notes: "Added a new Statuses page to see and manage every order's status in one place.",
  },
  {
    version: '0.50',
    date: '2026-10-01',
    notes: 'Fixed the Expense form losing focus while typing in the Name or Amount fields.',
  },
];

export const CURRENT_VERSION = CHANGELOG[0].version;
