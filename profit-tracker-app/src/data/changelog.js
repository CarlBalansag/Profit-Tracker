// Version history shown in the sidebar's "What's New" modal.
// Newest entry first. At most one new entry per push to main, in short,
// non-technical words, and small changes don't get their own version. See
// rule 8 in AGENTS.md.
export const CHANGELOG = [
  {
    version: '1.14',
    date: '2026-11-04',
    notes: 'The transaction editor now matches Add Transaction: same sections, plus order number, tracking number, receipt and buyer tax-exempt details. The sold section only shows once an item has sold.',
  },
  {
    version: '1.13',
    date: '2026-11-04',
    notes: "The Schedule C worksheet now shows refunds to buyers as returns and allowances, separate from your expenses.",
  },
  {
    version: '1.12',
    date: '2026-11-04',
    notes: "Cash Flow now shows how much was refunded by stores and to buyers, and marks refunded sales.",
  },
  {
    version: '1.11',
    date: '2026-11-04',
    notes: "The AI assistant can now record, list and remove refunds.",
  },
  {
    version: '1.10',
    date: '2026-11-03',
    notes: 'The AI assistant can now record the shipping cost on a sale and which card paid for the label.',
  },
  {
    version: '1.09',
    date: '2026-11-03',
    notes: 'Add Transaction, Record Sale and Add Expense now default to today\'s date in the evening instead of tomorrow\'s.',
  },
  {
    version: '1.08',
    date: '2026-11-03',
    notes: 'A cancelled, voided or returned sale whose units went back into stock can no longer be moved back to an active status. Record a new sale instead.',
  },
  {
    version: '1.07',
    date: '2026-11-03',
    notes: 'Lowering the quantity of a cancelled or returned sale, or refunding it, can no longer add units back to your stock that were already put back.',
  },
  {
    version: '1.06',
    date: '2026-11-03',
    notes: 'You can now record refunds instead of deleting a transaction: money back from a store on a purchase, or money you refunded a buyer on a sale, with any units returned. Your costs, profit, stock and card totals all update.',
  },
  {
    version: '1.05',
    date: '2026-11-02',
    notes: 'Deleting a cancelled, voided or returned sale, or editing its purchase afterwards, no longer counts those units twice in your stock.',
  },
  {
    version: '1.04',
    date: '2026-11-02',
    notes: 'You can now add a store return window when adding a purchase, and Record Sale, Inventory and the transaction editor show how many days you have left to return it.',
  },
  {
    version: '1.03',
    date: '2026-11-02',
    notes: 'Analytics, Cash Flow, Settings, Tax Exempt and Schedule C now scroll, so nothing at the bottom of those pages is cut off.',
  },
  {
    version: '1.02',
    date: '2026-11-01',
    notes: 'Switching between light and dark mode no longer briefly shows the dashboard stat cards that are scrolled out of view.',
  },
  {
    version: '1.01',
    date: '2026-10-31',
    notes: 'Your AI assistant now shows a full profit breakdown including card cashback, tells sold-out items apart, and lists inventory a page at a time.',
  },
  {
    version: '1.00',
    date: '2026-10-31',
    notes: 'Each sale and purchase now has its own notes (with pinning), shown alongside the shared product note in the transaction details.',
  },
  {
    version: '0.99',
    date: '2026-10-30',
    notes: 'Light and dark mode now follow your device\'s setting automatically; the day/night switch still lets you pick one yourself.',
  },
  {
    version: '0.98',
    date: '2026-10-30',
    notes: 'Added a day/night switch in the bottom-right corner that changes the theme with a rippling wave and gently lifts cards as it passes.',
  },
  {
    version: '0.97',
    date: '2026-10-29',
    notes: 'The Schedule C tax worksheet is back in the sidebar. It now adds the shipping labels and platform fees from your sales automatically and warns you about expenses that look like duplicates. Turn it on in Settings.',
  },
  {
    version: '0.96',
    date: '2026-10-28',
    notes: 'You can now pick which card paid for a shipping label when recording a sale, and those labels count toward that card\'s spend and cashback on the Credit Card page.',
  },
  {
    version: '0.95',
    date: '2026-10-28',
    notes: 'The Expenses tab now lists the tax, shipping, and fees from your purchases and sales automatically, including gift cards as credits, so you no longer need to enter shipping labels or platform fees twice.',
  },
  {
    version: '0.94',
    date: '2026-10-28',
    notes: 'Fixed the Add Transaction page so you can scroll down to the sold section and the Add Transaction button.',
  },
  {
    version: '0.93',
    date: '2026-10-25',
    notes: 'Completed full brand unification to Profit Tracker across tutorials, calendars, documentation, and system services.',
  },
  {
    version: '0.92',
    date: '2026-10-23',
    notes: 'Updated KPI cards to a soft lavender hover glow and Status Pipeline cards to an expanding top accent indicator on hover.',
  },
  {
    version: '0.91',
    date: '2026-10-23',
    notes: 'Added a smooth purple accent hover animation with crisp white text to clickable KPI and pipeline cards on the Dashboard.',
  },
  {
    version: '0.90',
    date: '2026-10-23',
    notes: 'Updated all vertical and horizontal scrollbars across every page, table, and modal to match the purple accent scrollbar on the Dashboard.',
  },
  {
    version: '0.89',
    date: '2026-10-23',
    notes: 'Brought the entire website into the premium light color palette.',
  },
  {
    version: '0.88',
    date: '2026-10-23',
    notes: 'Made the Dashboard Goals widget about 10% smaller overall — ring, icon, and text.',
  },
  {
    version: '0.87',
    date: '2026-10-23',
    notes: 'Top Cards on the Dashboard now shows 3 at a time with page arrows on every screen size, instead of a long list that made that row taller than the chart next to it.',
  },
  {
    version: '0.86',
    date: '2026-10-23',
    notes: 'Tinted the Dashboard and sidebar scrollbars with the purple accent color instead of plain grey.',
  },
  {
    version: '0.85',
    date: '2026-10-23',
    notes: 'Made the sidebar text and icons smaller across the board for a more compact look.',
  },
  {
    version: '0.84',
    date: '2026-10-23',
    notes: 'Fixed the sidebar title wrapping onto two lines at some window sizes, and matched its scrollbar to the light theme.',
  },
  {
    version: '0.83',
    date: '2026-10-23',
    notes: 'Shrank the sidebar menu text slightly and fixed a stray black scrollbar on the Dashboard so it matches the light theme.',
  },
  {
    version: '0.82',
    date: '2026-10-23',
    notes: 'Switched the accent color from orange to purple, and made the sidebar and Dashboard headings/labels a true black instead of grey for better readability.',
  },
  {
    version: '0.81',
    date: '2026-10-21',
    notes: 'Gave the Dashboard sidebar a matching light look, darkened the page background slightly, and added a softer shadow under cards so they stand out.',
  },
  {
    version: '0.80',
    date: '2026-10-21',
    notes: 'Redesigned the main Dashboard with a clean, modern light look — rounded white cards, soft shadows, and a bold highlight for your Net Profit.',
  },
  {
    version: '0.79',
    date: '2026-10-21',
    notes: 'Simplified Settings > Appearance by removing the extra accent color choices, so there\'s now one consistent color scheme.',
  },
  {
    version: '0.78',
    date: '2026-10-21',
    notes: 'On the Glassmorphism Brown dashboard, the Goals card now sits next to Payment Cards as a pair of side-by-side cards instead of its own full-width row.',
  },
  {
    version: '0.77',
    date: '2026-10-21',
    notes: 'Fixed the Glassmorphism Brown dashboard so the Goals card no longer stretches to fill the whole screen, pushing everything else out of view until you scrolled.',
  },
  {
    version: '0.76',
    date: '2026-10-21',
    notes: 'Signing in after clicking your verification email link now continues on its own, instead of needing an extra "Continue" click.',
  },
  {
    version: '0.75',
    date: '2026-10-21',
    notes: 'Changing your password now opens a small popup from your Profile instead of a plain form always sitting at the top of Settings.',
  },
  {
    version: '0.74',
    date: '2026-10-21',
    notes: 'Added a built-in guide to Settings > AI Assistant showing everything your assistant can read and update, plus setup steps.',
  },
  {
    version: '0.73',
    date: '2026-10-21',
    notes: 'Your AI assistant can now check shipping status, update tracking numbers, and see what you still owe on each credit card. Also fixed the "Last 4 Digits" field on a card not actually saving.',
  },
  {
    version: '0.72',
    date: '2026-10-19',
    notes: 'Added a quick fade-in when paging through Goals, Status Pipeline, or Top Cards on the Dashboard.',
  },
  {
    version: '0.71',
    date: '2026-10-19',
    notes: 'On narrow screens, the Dashboard’s Status Pipeline and Top Cards now page through a few at a time instead of a long list. Also made the Dashboard’s two scroll bars easier to grab without accidentally clicking what’s above them.',
  },
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
