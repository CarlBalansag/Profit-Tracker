// Tax deadlines for a year, from the versioned rules: the IRS's four
// estimated-tax installments, the filing deadline, and the state's installments
// where its schedule is verified. Dates and titles only: the calendar feed is
// reachable by a link, so no amounts go into it.
import { FEDERAL_RULES } from './rules/federal.mjs';
import { STATE_RULES, STATE_NAMES } from './rules/states.mjs';

export function taxDeadlines({ year, state = null }) {
  year = Number(year);
  const rules = FEDERAL_RULES[year];
  if (!rules) return [];
  const out = rules.estimatedTax.installments.map((i) => ({
    id: `tax_US_${year}_${i.period}`, date: i.due, kind: 'estimated', jurisdiction: 'US', period: i.period,
    title: `Federal estimated tax due: ${i.period} ${year}`,
    notes: `Quarterly estimated tax for ${year} (${i.covers}), if you expect to owe $1,000 or more. See your Schedule C tax estimate for the amount.`,
  }));
  out.push({
    id: `tax_US_${year}_filing`, date: `${year + 1}-04-15`, kind: 'filing', jurisdiction: 'US', period: 'filing',
    title: `${year} tax return due`,
    notes: `File your ${year} return and pay any balance, or file for an extension (the extension doesn't extend the time to pay). If the date falls on a weekend or holiday, it moves to the next business day.`,
  });
  const code = String(state || '').toUpperCase();
  const est = STATE_RULES[year]?.[code]?.estimatedTax;
  if (est?.installments?.length && !est.notRequired) {
    for (const i of est.installments) {
      out.push({
        id: `tax_${code}_${year}_${i.period}`, date: i.due, kind: 'estimated', jurisdiction: code, period: i.period,
        title: `${STATE_NAMES[code]} estimated tax due: ${i.period} ${year}`,
        notes: `${STATE_NAMES[code]} quarterly estimated tax for ${year}, if you're required to pay it. See your Schedule C tax estimate.`,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
