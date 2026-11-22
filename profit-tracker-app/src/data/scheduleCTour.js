// The Schedule C page tour, for someone who has never done self-employment
// taxes. Started from the "?" button on the page. Each step points at a
// data-tutorial-id on the page; `view` switches the page to the tab the step
// is about; `optional` steps are skipped when that part isn't showing (for
// example, there are no warnings to fix).
export const SCHEDULE_C_STEPS = [
  {
    id: 'sc-intro', view: 'overview', target: null, placement: 'center',
    title: 'Taxes for your reselling, step by step',
    body: 'Schedule C is the IRS form where a one-person business, like reselling, reports its profit. This page fills it in from the purchases, sales and expenses you already track, and estimates the tax on it. It\'s a helper: nothing is sent to the IRS.',
  },
  {
    id: 'sc-year', view: 'overview', target: 'sc-year', placement: 'bottom',
    title: 'Pick the tax year',
    body: 'Choose the year your sales and purchases happened. Taxes for a year are filed the next spring, so in April 2027 you\'d look at 2026.',
  },
  {
    id: 'sc-tabs', view: 'overview', target: 'sc-tabs', placement: 'bottom',
    title: 'Three views',
    body: 'Tax estimate: how much tax you may owe and how much to save for it. Worksheet: your profit, the records behind it, and a to-do list. Year-end report: a clean summary to give a tax preparer. This tour visits all three.',
  },
  {
    id: 'sc-setup', view: 'overview', target: 'sc-setup', placement: 'bottom', optional: true,
    title: 'Answer three questions',
    body: 'Your state, filing status (single, married…) and other income, like a job, decide your tax bracket. We never ask for your name or Social Security number. Not sure? "Skip: use a flat 25%" gives a rough number to start with.',
  },
  {
    id: 'sc-estimate', view: 'overview', target: 'sc-estimate-cards', placement: 'bottom', optional: true,
    title: 'The four answers',
    body: 'Profit so far: what the business made this year. Tax the business adds: the extra tax you owe because of that profit. Set aside: how much to keep in savings for it. Next payment due: when the IRS (and your state) expect money.',
  },
  {
    id: 'sc-projection', view: 'overview', target: 'sc-projection', placement: 'bottom', optional: true,
    title: 'A guess at the whole year',
    body: 'The year isn\'t over, so the estimate projects your profit to December 31 from your pace so far. Open it to pick another way, like last year\'s pattern or a number you choose.',
  },
  {
    id: 'sc-math', view: 'overview', target: 'sc-math', placement: 'bottom', optional: true,
    title: 'How we worked it out',
    body: 'Open this to see the math in plain steps. Switch Simple to Detailed at the top of the estimate to see every line and the official sources.',
  },
  {
    id: 'sc-whatif', view: 'overview', target: 'sc-whatif', placement: 'bottom', optional: true,
    title: 'Try "what if"',
    body: 'See how a bigger month, a business purchase or a retirement contribution would change your tax. It\'s only a calculation: nothing is saved.',
  },
  {
    id: 'sc-saved', view: 'overview', target: 'sc-saved', placement: 'top', optional: true,
    title: 'Money saved for taxes',
    body: 'Write down money you move into savings for taxes, and see if it\'s enough. Moving money aside isn\'t an expense; it just keeps you from spending what you\'ll owe.',
  },
  {
    id: 'sc-payments', view: 'overview', target: 'sc-payments', placement: 'top', optional: true,
    title: 'Paying during the year',
    body: 'When you work for yourself, no one takes tax out of your pay, so the IRS expects payments during the year ("estimated tax"), not all in April. This shows what\'s due and when. Record each payment you make here.',
  },
  {
    id: 'sc-deductions', view: 'overview', target: 'sc-deductions', placement: 'top', optional: true,
    title: 'Deductions you might be missing',
    body: 'A deduction is a cost that lowers your taxable profit. These are ideas worth checking, like driving to the post office or a home office. Nothing is claimed unless you add it.',
  },
  {
    id: 'sc-profit', view: 'worksheet', target: 'sc-profit', placement: 'bottom',
    title: 'Your profit in four numbers',
    body: 'Gross receipts: what your sales brought in. Cost of goods sold: what the items you sold cost you. Expenses: your other business costs. Net profit: sales minus both, and the number you pay tax on.',
  },
  {
    id: 'sc-warnings', view: 'worksheet', target: 'sc-warnings', placement: 'bottom', optional: true,
    title: 'Yellow boxes: fix these',
    body: 'Something in your records looks off, like a sale dated before you bought the item. Fix it on that transaction and the numbers here update.',
  },
  {
    id: 'sc-lines', view: 'worksheet', target: 'sc-lines', placement: 'bottom',
    title: 'The actual form lines',
    body: 'The same numbers laid out line by line as they go on the IRS form. Handy for you or a preparer; nothing to do here.',
  },
  {
    id: 'sc-logs', view: 'worksheet', target: 'sc-logs', placement: 'top',
    title: 'Extra deductions you add yourself',
    body: 'Driving for the business (to stores, the post office), equipment like a label printer or shelves, and a space at home used only for the business. Each one lowers your profit. Skip any that don\'t apply.',
  },
  {
    id: 'sc-extras', view: 'worksheet', target: 'sc-extras', placement: 'top',
    title: 'Only if they apply',
    body: 'Stock you owned before using ProfitTracker, 1099-K forms that eBay or PayPal send you, and why this profit differs from the Dashboard. Open one only if you need it.',
  },
  {
    id: 'sc-notes', view: 'worksheet', target: 'sc-notes', placement: 'top', optional: true,
    title: 'Notes',
    body: 'Explanations of choices made for you, like card rewards lowering what your items cost instead of counting as income. Read them once; there\'s nothing to do.',
  },
  {
    id: 'sc-expense-cards', view: 'worksheet', target: 'sc-expense-cards', placement: 'bottom',
    title: 'Expenses at a glance',
    body: 'Worksheet total: what counts right now. Needs review: expenses that don\'t count until you check them. Missing receipts: expenses without a photo or PDF of the receipt (keep receipts in case the IRS asks).',
  },
  {
    id: 'sc-duplicates', view: 'worksheet', target: 'sc-duplicates', placement: 'bottom', optional: true,
    title: 'Possible duplicates',
    body: 'An expense looks like it was entered twice, or matches a shipping label already taken from a sale. Delete the extra one so it isn\'t counted twice.',
  },
  {
    id: 'sc-categories', view: 'worksheet', target: 'sc-categories', placement: 'top',
    title: 'IRS categories',
    body: 'The IRS groups expenses into buckets like Supplies or Postage. Each reviewed expense goes in one. Tap a bucket to see its records.',
  },
  {
    id: 'sc-queue', view: 'worksheet', target: 'sc-queue', placement: 'bottom',
    title: 'Your to-do list',
    body: 'Each expense you typed in needs a quick check before it counts ("worksheet $0.00" means not yet). Tap Review, then "Use suggestions" to fill most of it in, check it, and use "Save and review next" to go through them all.',
  },
  {
    id: 'sc-report-status', view: 'reports', target: 'sc-report-status', placement: 'bottom',
    title: 'Finish the year',
    body: 'When the year is over and everything is reviewed, Finalize saves a copy of the numbers. If you change something later, this shows exactly what changed and lets you save a new version.',
  },
  {
    id: 'sc-report-downloads', view: 'reports', target: 'sc-report-downloads', placement: 'bottom',
    title: 'Give it to your tax preparer',
    body: 'Print or save a PDF of the report below, or download the lines as a spreadsheet. Send it along with your receipts.',
  },
  {
    id: 'sc-done', view: 'worksheet', target: null, placement: 'center',
    title: 'Where to start',
    body: '1. Review your expenses in the Worksheet\'s to-do list. 2. Fix any yellow warnings. 3. Add driving, equipment or a home office if they apply. 4. Check the Tax estimate and save what it says. Tap the ? button any time to see this again.',
  },
];
