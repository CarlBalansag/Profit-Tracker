// Deductions a reseller may be missing, from what the records do and don't
// show. Each is a prompt to look into, never claimed automatically: it says
// why it might apply, what records to keep, the limits, and the IRS page.
// Figures are per tax year from official sources (see notes/schedule-c-tax-plan.md).

const SOURCES = {
  mileage: { label: 'IRS: Standard mileage rates', url: 'https://www.irs.gov/tax-professionals/standard-mileage-rates' },
  homeOffice: { label: 'IRS: Home office deduction', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/home-office-deduction' },
  pub334: { label: 'IRS Publication 334, Tax Guide for Small Business', url: 'https://www.irs.gov/publications/p334' },
  deMinimis: { label: 'IRS: Tangible property regulations (de minimis safe harbor)', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations' },
  health: { label: 'IRS: About Form 7206, self-employed health insurance deduction', url: 'https://www.irs.gov/forms-pubs/about-form-7206' },
  retirement: { label: 'IRS: Retirement plans for self-employed people', url: 'https://www.irs.gov/retirement-plans/retirement-plans-for-self-employed-people' },
};

// Business standard mileage rate, in cents per mile.
export const MILEAGE_RATES = {
  2025: [{ from: '2025-01-01', cents: 70 }],
  2026: [{ from: '2026-01-01', cents: 72.5 }, { from: '2026-07-01', cents: 76 }],
};
export const HOME_OFFICE_SIMPLIFIED = { perSquareFoot: 5, maxSquareFeet: 300 };
export const DE_MINIMIS_PER_ITEM = 2500;

const mileageText = (year) => {
  const rates = MILEAGE_RATES[year];
  if (!rates) return 'the IRS standard mileage rate for the year';
  return rates.length === 1 ? `${rates[0].cents}¢ a mile in ${year}`
    : `${rates.map((r, i) => `${r.cents}¢ a mile ${i === 0 ? `before ${new Date(`${rates[1].from}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}` : 'from then on'}`).join(' and ')} in ${year}`;
};

const hasWord = (names, words) => names.some((n) => words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(n)));

/**
 * year; categoryCounts: { SUPPLIES: n, ... } of reviewed expenses on the
 * worksheet; expenseNames: names of the year's expenses; saleCount; profit
 * (line 31, or projected). Returns checks to show, most relevant first.
 */
// recorded: what ProfitTracker's own logs already have this year
// ({ mileage, homeOffice, equipment } booleans); a logged one isn't suggested.
// Checks that can be recorded on the worksheet say so with `logOn`.
export function discoverDeductions({ year, categoryCounts = {}, expenseNames = [], saleCount = 0, profit = 0, recorded = {} }) {
  const names = expenseNames.map((n) => String(n || '').toLowerCase());
  const has = (cat) => (categoryCounts[cat] || 0) > 0;
  const selling = saleCount > 0;
  const out = [];

  if (selling && !recorded.mileage && !hasWord(names, ['mileage', 'miles', 'gas', 'fuel'])) {
    out.push({
      id: 'mileage', where: 'Schedule C line 9', logOn: 'Driving for the business',
      title: 'Driving for the business',
      why: `Trips to stores, the post office or a buyer can be deducted at ${mileageText(year)}, instead of what you spent on gas. Commuting doesn't count.`,
      docs: 'A mileage log: date, where you went, why, and the miles, kept as you go.',
      limits: 'Use the standard rate or your actual car costs, not both. Only the business share of the miles counts.',
      source: SOURCES.mileage,
    });
  }
  if (selling && !recorded.homeOffice) {
    out.push({
      id: 'home_office', where: 'Schedule C line 30', logOn: 'Home office',
      title: 'A space at home used for the business',
      why: `If part of your home is used regularly and only for the business, the simplified method gives $${HOME_OFFICE_SIMPLIFIED.perSquareFoot} a square foot, up to ${HOME_OFFICE_SIMPLIFIED.maxSquareFeet} square feet ($${(HOME_OFFICE_SIMPLIFIED.perSquareFoot * HOME_OFFICE_SIMPLIFIED.maxSquareFeet).toLocaleString('en-US')}). Space used regularly to store inventory can count even if it isn't used only for the business, when your home is the business's only fixed location.`,
      docs: 'The square footage, and photos or notes showing how the space is used.',
      limits: profit > 0 ? 'It can\'t create a loss: it\'s capped at your business profit.' : 'It can\'t create a loss: with no profit this year it won\'t lower your tax.',
      source: SOURCES.homeOffice,
    });
  }
  if (selling && !has('SUPPLIES')) {
    out.push({
      id: 'supplies', where: 'Schedule C line 22',
      title: 'Packing and shipping supplies',
      why: 'You have sales but no supplies recorded: boxes, mailers, tape, labels and printer paper are deductible when you buy them.',
      docs: 'Receipts or order confirmations.',
      limits: 'Supplies you use for yourself don\'t count.',
      source: SOURCES.pub334,
    });
  }
  if (!hasWord(names, ['phone', 'cell', 'wireless', 'internet', 'wifi', 'verizon', 'att', 't-mobile', 'tmobile', 'comcast', 'xfinity', 'spectrum'])) {
    out.push({
      id: 'phone_internet', where: 'Schedule C line 25 or 27b',
      title: 'Phone and internet, business share',
      why: 'If you use your phone or internet to list, message buyers or buy stock, the business share of the bill is deductible.',
      docs: 'Your bills and a reasonable way you worked out the business percentage.',
      limits: 'The first phone line into your home isn\'t deductible; a separate line or a cell phone\'s business share is.',
      source: SOURCES.pub334,
    });
  }
  if (selling && !recorded.equipment && !hasWord(names, ['printer', 'scale', 'computer', 'laptop', 'camera', 'shelf', 'shelves', 'shelving', 'tablet'])) {
    out.push({
      id: 'equipment', where: 'Schedule C line 13 or 22', logOn: 'Equipment',
      title: 'Equipment: label printer, scale, shelving, computer',
      why: `Equipment can usually be deducted in full the year you buy it: items up to $${DE_MINIMIS_PER_ITEM.toLocaleString('en-US')} each under the de minimis safe harbor, or more through Section 179 or bonus depreciation.`,
      docs: 'The receipt, and the date you started using it. Note the business-use percentage if you also use it personally.',
      limits: 'Only the business-use share counts. The de minimis election has to be made on that year\'s return.',
      source: SOURCES.deMinimis,
    });
  }
  if (profit > 0) {
    out.push({
      id: 'retirement', where: 'Outside Schedule C (Schedule 1)',
      title: 'Saving for retirement (SEP IRA or solo 401(k))',
      why: 'Contributions from self-employment profit can lower your income tax for the year. They don\'t lower self-employment tax.',
      docs: 'Statements from the retirement account.',
      limits: 'Limits depend on your net self-employment earnings and the plan type; check before contributing.',
      source: SOURCES.retirement,
    });
    out.push({
      id: 'health', where: 'Outside Schedule C (Schedule 1)',
      title: 'Health insurance you pay for yourself',
      why: 'If you pay for your own health insurance and couldn\'t get it through an employer\'s plan (yours or a spouse\'s), premiums can be deducted up to your business profit.',
      docs: 'Premium statements.',
      limits: 'Not for any month you could join an employer-subsidized plan. Lowers income tax, not self-employment tax.',
      source: SOURCES.health,
    });
  }
  return out;
}
