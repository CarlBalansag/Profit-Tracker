// Phase 8a: what-if scenarios through the real engine, and deduction checks
// that are suggested, never claimed.
import { describe, expect, it } from 'vitest';
import { runWhatIf, discoverDeductions, MILEAGE_RATES, buildTaxOverview } from '../../shared/tax/index.mjs';

const single = { filing_status: 'single', state: 'TX', non_business_income: '0' };
const today = '2026-11-21';

describe('runWhatIf', () => {
  it('shows a deductible expense saving tax at the marginal rate, not dollar for dollar', () => {
    const r = runWhatIf({ profile: single, year: 2026, baseProfit: 50000, today, changes: { extraExpense: 1000 } });
    expect(r.rows[0]).toEqual(['Business profit', 50000, 49000]);
    expect(r.rows[1]).toEqual(['Total tax', 9732.07, 9501.55]);
    expect([r.diffTax, r.savedPerDollar, r.netCost]).toEqual([-230.52, 0.231, 769.48]);
    // About the marginal rate the estimate reports.
    expect(buildTaxOverview({ profile: single, year: 2026, businessProfit: 50000, today }).impact.marginalRate).toBeCloseTo(0.23, 2);
  });

  it('matches a fresh estimate at the changed numbers', () => {
    const r = runWhatIf({ profile: single, year: 2026, baseProfit: 40000, today, changes: { extraProfit: 10000 } });
    expect(r.scenario.impact.withBusiness.totalTax).toBe(9732.07);
    expect(r.diffTax).toBeGreaterThan(0);
  });

  it('applies retirement as an adjustment, and other income without making wages exceed it', () => {
    const p = { ...single, non_business_income: '30000', wages: '30000', adjustments: '500' };
    const r = runWhatIf({ profile: p, year: 2026, baseProfit: 20000, today, changes: { retirement: 4000, otherIncomeChange: -10000 } });
    expect(r.scenario.impact.withBusiness.federal.adjustments).toBe(4500);
    expect(r.scenario.impact.withBusiness.federal.totalIncome).toBe(40000);
    // A retirement contribution lowers income tax, not self-employment tax.
    expect(r.scenario.impact.withBusiness.federal.selfEmployment.total).toBe(r.base.impact.withBusiness.federal.selfEmployment.total);
  });

  it('can\'t run without a filing status', () => {
    expect(runWhatIf({ profile: { reserve_mode: 'flat' }, year: 2026, baseProfit: 1000, today, changes: { extraExpense: 10 } }).supported).toBe(false);
  });
});

describe('discoverDeductions', () => {
  const ids = (args) => discoverDeductions({ year: 2026, ...args }).map((d) => d.id);

  it('suggests what the records don\'t show yet, each with why, records, limits and an IRS page', () => {
    const all = discoverDeductions({ year: 2026, saleCount: 3, profit: 5000 });
    expect(all.map((d) => d.id)).toEqual(['mileage', 'home_office', 'supplies', 'phone_internet', 'equipment', 'retirement', 'health']);
    for (const d of all) {
      expect(d.why && d.docs && d.limits && d.where).toBeTruthy();
      expect(d.source.url).toMatch(/^https:\/\/www\.irs\.gov\//);
    }
    expect(all[0].why).toMatch(/72\.5¢ a mile before July 1 and 76¢ a mile from then on in 2026/);
    expect(discoverDeductions({ year: 2025, saleCount: 1 })[0].why).toMatch(/70¢ a mile in 2025/);
    expect(MILEAGE_RATES[2026]).toEqual([{ from: '2026-01-01', cents: 72.5 }, { from: '2026-07-01', cents: 76 }]);
  });

  it('drops a check once the records show it, matching whole words only', () => {
    expect(ids({ saleCount: 3, profit: 1, categoryCounts: { SUPPLIES: 2 }, expenseNames: ['Verizon Wireless', 'Dymo label printer', 'Mileage Q1'] }))
      .toEqual(['home_office', 'retirement', 'health']);
    // "Cattle" isn't "att", "Gasket" isn't "gas".
    expect(ids({ saleCount: 3, expenseNames: ['Cattle feed', 'Gasket'] })).toContain('phone_internet');
    expect(ids({ saleCount: 3, expenseNames: ['Gasket'] })).toContain('mileage');
  });

  it('keeps business-only checks for a business with sales, and profit-based ones for a profit', () => {
    expect(ids({ saleCount: 0, profit: 0 })).toEqual(['phone_internet']);
    expect(discoverDeductions({ year: 2026, saleCount: 1, profit: -100 }).find((d) => d.id === 'home_office').limits).toMatch(/no profit this year/);
  });
});
