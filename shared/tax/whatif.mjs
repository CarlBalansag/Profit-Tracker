// What-if scenarios through the real engine: the same profile and projected
// profit as the estimate, with changes applied. Nothing here touches records.
import { buildTaxOverview } from './overview.mjs';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const c = (v) => Math.round(n(v) * 100);

/**
 * profile: the estimate's profile; baseProfit: the profit the estimate uses
 * (projected or actual). changes: { extraProfit, extraExpense, retirement,
 * otherIncomeChange } in dollars.
 */
export function runWhatIf({ profile, year, baseProfit, today, changes = {} }) {
  const scenarioProfit = (c(baseProfit) + c(changes.extraProfit) - c(changes.extraExpense)) / 100;
  const otherIncome = Math.max(0, (c(profile?.non_business_income) + c(changes.otherIncomeChange)) / 100);
  const scenarioProfile = {
    ...profile,
    non_business_income: String(otherIncome),
    // Wages can't be more than other income; extra income is treated as non-wage.
    wages: profile?.wages != null && profile.wages !== '' ? String(Math.min(n(profile.wages), otherIncome)) : profile?.wages,
    adjustments: String((c(profile?.adjustments) + c(changes.retirement)) / 100),
  };
  const base = buildTaxOverview({ profile, year, businessProfit: n(baseProfit), today });
  const scenario = buildTaxOverview({ profile: scenarioProfile, year, businessProfit: scenarioProfit, today });
  if (!base.impact || !scenario.impact) return { supported: false, base, scenario };
  const total = (o) => o.impact.withBusiness.totalTax;
  const diffTax = (c(total(scenario)) - c(total(base))) / 100;
  const spent = n(changes.extraExpense) + n(changes.retirement);
  return {
    supported: true,
    base, scenario,
    rows: [
      ['Business profit', base.businessProfit, scenario.businessProfit],
      ['Total tax', total(base), total(scenario)],
      ['Tax the business adds', Math.max(0, base.impact.additionalTaxFromBusiness), Math.max(0, scenario.impact.additionalTaxFromBusiness)],
      ['Recommended to set aside', base.recommended, scenario.recommended],
    ],
    diffTax,
    // For money spent (an expense or a contribution): what it saves in tax,
    // and what it still costs after the savings.
    spent,
    savedPerDollar: spent > 0 ? Math.round(-diffTax / spent * 1000) / 1000 : null,
    netCost: spent > 0 ? (c(spent) + c(diffTax)) / 100 : null,
  };
}
