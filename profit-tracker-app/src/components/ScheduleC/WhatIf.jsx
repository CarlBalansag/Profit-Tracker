import { useState } from 'react';
import { runWhatIf } from '../../../../shared/tax/index.mjs';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const signed = (n) => (n > 0 ? `+${usd(n)}` : n < 0 ? `-${usd(Math.abs(n))}` : usd(0));
const pct = (r) => `${Math.round(Number(r) * 1000) / 10}%`;
const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] py-2 pl-7 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none';
const FIELDS = [
  ['extraProfit', 'More (or less) profit this year', 'Use a minus sign for less, like -2000.', true],
  ['extraExpense', 'A deductible business expense', 'Something the business would buy, like supplies or equipment.', false],
  ['retirement', 'A deductible retirement contribution', 'A SEP IRA or solo 401(k) contribution.', false],
  ['otherIncomeChange', 'More (or less) income outside the business', 'A raise, a second job, or less work. Minus for less.', true],
];
const valid = (v, allowNegative) => String(v).trim() === '' || (allowNegative ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(String(v).trim());

/**
 * Change a few things and see the effect, using the same engine, profile and
 * profit as the estimate above. Nothing is saved and no records change.
 */
export function WhatIf({ year, profile, baseProfit, marginalRate, today }) {
  const [values, setValues] = useState({ extraProfit: '', extraExpense: '', retirement: '', otherIncomeChange: '' });
  const bad = FIELDS.find(([key, , , neg]) => !valid(values[key], neg));
  const changes = Object.fromEntries(FIELDS.map(([key]) => [key, Number(values[key]) || 0]));
  const any = Object.values(changes).some(Boolean);
  const result = !bad && any ? runWhatIf({ profile, year, baseProfit, today, changes }) : null;
  const onlySpending = !changes.extraProfit && !changes.otherIncomeChange && result?.spent > 0;

  return <div className="mt-3 space-y-4 text-sm">
    <div className="rounded-lg border border-white/10 p-3">
      <p className="font-medium text-white">Why a deduction isn&apos;t free money</p>
      <p className="mt-1 text-gray-400">A simple example: if every dollar of profit were taxed at 10%, spending $100 on a deductible expense would cut your tax by $10. You&apos;d still be out $90. Deduct what the business really needs; don&apos;t buy things just for the deduction.</p>
      {marginalRate != null && <p className="mt-1 text-gray-300">For you, each extra $100 of business profit adds about {usd(marginalRate * 100)} of tax right now (all taxes together), so a $100 deductible expense saves about that much.</p>}
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map(([key, label, help]) => <div key={key}>
        <label htmlFor={`whatif-${key}`} className="block text-gray-300">{label}</label>
        <div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
          <input id={`whatif-${key}`} type="text" inputMode="decimal" value={values[key]} placeholder="0" onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} className={inputCls} aria-describedby={`whatif-${key}-help`} /></div>
        <p id={`whatif-${key}-help`} className="mt-1 text-xs text-gray-500">{help}</p>
      </div>)}
    </div>
    {bad && <p role="alert" className="text-red-400">Enter dollars and cents for &quot;{bad[1]}&quot;, like 1000 or 1000.50{bad[3] ? ' (minus for less)' : ''}.</p>}

    {result?.supported && <div aria-live="polite">
      <div className="overflow-x-auto"><table className="w-full text-xs sm:text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="pb-1 font-normal" /><th className="pb-1 text-right font-normal">Now</th><th className="pb-1 text-right font-normal">What if</th><th className="pb-1 text-right font-normal">Change</th></tr></thead>
        <tbody>{result.rows.map(([label, a, b]) => <tr key={label} className="border-t border-white/5 text-gray-300">
          <td className="py-2 pr-3">{label}</td><td className="whitespace-nowrap py-2 text-right tabular-nums" style={{ paddingLeft: 6 }}>{usd(a)}</td><td className="whitespace-nowrap py-2 text-right tabular-nums" style={{ paddingLeft: 6 }}>{usd(b)}</td><td className="whitespace-nowrap py-2 text-right tabular-nums" style={{ paddingLeft: 6 }}>{signed(Math.round((b - a) * 100) / 100)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="mt-2 text-gray-200">{result.diffTax < 0 ? `Your total tax would go down by ${usd(-result.diffTax)}.` : result.diffTax > 0 ? `Your total tax would go up by ${usd(result.diffTax)}.` : 'Your total tax wouldn\'t change.'}
        {onlySpending && result.savedPerDollar != null && ` Spending ${usd(result.spent)} saves about ${pct(result.savedPerDollar)} of it in tax, so it still costs you about ${usd(result.netCost)}.`}</p>
      <p className="mt-1 text-xs text-gray-500">Uses the same details and projected profit as the estimate above. Just a calculation: nothing is saved and no records change.</p>
    </div>}
    {result && !result.supported && <p className="text-gray-400">Add your filing status to try scenarios.</p>}
  </div>;
}
