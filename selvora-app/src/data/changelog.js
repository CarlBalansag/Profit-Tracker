// Version history shown in the sidebar's "What's New" modal.
// Newest entry first. Whenever a feature, update, or fix ships, bump the
// version and add a short, non-technical entry here.
export const CHANGELOG = [
  {
    version: '0.70',
    date: '2026-10-19',
    notes: 'Fixed the Tax Exempt page’s top revenue number spilling past its card on narrow phones.',
  },
  {
    version: '0.69',
    date: '2026-10-19',
    notes: 'Fixed two more sideways-scrolling glitches on small phones: a brief shift while the Tax Exempt page loads, and the date-range buttons on the Analytics page.',
  },
  {
    version: '0.68',
    date: '2026-10-18',
    notes: 'Fixed the Tax Exempt page shifting sideways on narrow phones — the page header and the tabs/search row now stack cleanly instead of overflowing.',
  },
  {
    version: '0.67',
    date: '2026-10-14',
    notes: 'Fixed the Dashboard greeting wrapping awkwardly onto three lines on tablet-sized screens.',
  },
  {
    version: '0.66',
    date: '2026-10-14',
    notes: 'Fixed the Credit Card page on narrow phones — numbers no longer get cut off, and the cashback badges now scroll instead of getting hidden.',
  },
  {
    version: '0.65',
    date: '2026-10-14',
    notes: 'Fixed the welcome tour on small screens — steps now scroll into view, stay fully on screen, and the menu opens automatically when a step points to it.',
  },
  {
    version: '0.64',
    date: '2026-10-13',
    notes: 'Fixed the Payment Methods page in Settings cutting off the "Perks" stat card on small screens.',
  },
  {
    version: '0.63',
    date: '2026-10-13',
    notes: 'Fixed a mobile bug where tapping "Recent Sales" on the Analytics page could shift the whole screen sideways and cut off text.',
  },
  {
    version: '0.62',
    date: '2026-10-13',
    notes: 'Fixed several mobile layout issues: the menu now closes after you tap a page, the add-purchase form no longer cuts off tax/shipping/fee amounts, the credit card date no longer overlaps its badge, and tapping "more" on a busy calendar day now opens a readable list.',
  },
  {
    version: '0.61',
    date: '2026-10-08',
    notes: 'Mark Paid now works once a sale has shipped, even before delivery — and your AI assistant can assign buyers and flag personal accounts too.',
  },
  {
    version: '0.60',
    date: '2026-10-07',
    notes: 'Payment methods can now be marked as personal, so the app can track what the business owes you back.',
  },
  {
    version: '0.59',
    date: '2026-10-07',
    notes: 'Added a Settings page for connecting an AI assistant to read and update your reselling data.',
  },
  {
    version: '0.58',
    date: '2026-10-07',
    notes: 'You can now pick who actually paid you (a buyer) when recording or editing a sale.',
  },
  {
    version: '0.57',
    date: '2026-10-07',
    notes: 'Cash Flow now shows Paid, Partial, or Pending accurately instead of always showing Pending.',
  },
  {
    version: '0.56',
    date: '2026-10-06',
    notes: "Fixed Edit Transaction failing to save for a handful of old sales with a leftover invalid status.",
  },
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
