// A GET /api/analytics/cashflow response for page tests: one buyer with a
// late sale and a short-paid one, one card with an open statement, and a
// few months of money in and out.
export const cashFlowFixture = (over = {}) => ({
  asOf: '2026-11-17',
  summary: {
    owedTotal: 296, owedCount: 2, lateCount: 1, billsDue30: 520, coverageGap: -224,
    inStock: 312, stockUnits: 3, netThisMonth: 150, netLastMonth: -272,
  },
  owed: [{
    name: 'eBay Buyer', amount: 296, count: 2, oldestDays: 30, maxLateDays: 16, expectedDays: 14,
    expectedBasis: 'default', shortPaidPct: null, state: 'late',
    items: [
      { id: 's1', product: 'Lego Set', saleDate: '2026-10-18', amount: 273, payoutStatus: 'unpaid', waitingDays: 30, expectedDate: '2026-11-01', lateDays: 16, state: 'late' },
      { id: 's2', product: 'Jordan 4', saleDate: '2026-11-10', amount: 23, payoutStatus: 'partial', waitingDays: 7, expectedDate: '2026-11-24', lateDays: 0, state: 'on_time' },
    ],
  }],
  cards: [{
    id: 'c1', name: 'QA Credit Card', last4: '1234', balance: 520, statementBalance: 520, currentCycle: 0,
    statementDue: '2026-12-10', statementOpen: true, nextClose: '2026-12-15', limit: 5000, utilizationPct: 10.4, hasDates: true,
  }],
  coverage: [{
    card: 'QA Credit Card', cardId: 'c1', dueDate: '2026-12-10', dueInDays: 23, amount: 520, final: true,
    payoutsBefore: 296, billsSoFar: 520, covered: false, gap: -224,
  }],
  monthly: Array.from({ length: 12 }, (_, i) => {
    const m = `${i < 2 ? 2025 : 2026}-${String(((i + 10) % 12) + 1).padStart(2, '0')}`;
    return { month: m, payouts: 100, storeRefunds: 0, purchases: 50, expenses: 25, buyerRefunds: 0, in: 100, out: 75, net: 25 };
  }),
  tiedUp: Array.from({ length: 16 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, inventory: 312, unpaid: 296, total: 608 })),
  map: { putIn: 1040, inStock: 312, stockUnits: 3, unpaid: 296, unpaidCount: 2, paidBack: 400 },
  ...over,
});
