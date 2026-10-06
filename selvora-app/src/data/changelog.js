// Version history shown in the sidebar's "What's New" modal.
// Newest entry first. Whenever a feature, update, or fix ships, bump the
// version and add a short, non-technical entry here.
export const CHANGELOG = [
  {
    version: '0.55',
    date: '2026-10-06',
    notes: 'Analytics now shows how much each Cashout or Marketplace platform has paid you, spend by vendor, profit by category, and your cashback rate over time.',
  },
  {
    version: '0.54',
    date: '2026-10-06',
    notes: 'Dashboard quick info now explains summary numbers and status cards in clearer, everyday language.',
  },
  {
    version: '0.53',
    date: '2026-10-06',
    notes: 'Dashboard status cards now match the new workflow while keeping your existing visibility and order choices.',
  },
  {
    // This single entry replaces what was previously six separate version
    // bumps (0.52-0.57), one per commit made while this feature was still on
    // its branch. It only actually reached main in one push, on this date --
    // see AGENTS.md: a version bump belongs to an actual push to main, not to
    // each commit along the way.
    version: '0.52',
    date: '2026-10-04',
    notes: 'Added a new Statuses page to track every purchase and sale in one place, with grouped and correctable tracking numbers, accurate status counts, and properly tracked completed sales, plus matching updates to the Shipping page.',
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
