import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { buildTaxOverview } from '../../../../shared/tax/index.mjs';
import { localToday } from '../../utils/returnWindow';
import { Panel, GrowBar } from '../Analytics/Motion';

const usd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function load(year) {
  const pref = await (await requireSuccessfulResponse(await apiFetch('/api/preferences/schedule-c'))).json();
  if (!pref.enabled) return null;
  const [report, profile, ledger] = await Promise.all([
    apiFetch(`/api/schedule-c?year=${year}`).then(requireSuccessfulResponse).then((r) => r.json()),
    apiFetch(`/api/tax/profile/${year}`).then(requireSuccessfulResponse).then((r) => r.json()),
    apiFetch(`/api/tax/reserves/${year}`).then(requireSuccessfulResponse).then((r) => r.json()),
  ]);
  return { report, profile: profile.profile, ledger };
}

/**
 * This year's tax reserve on the Cash Flow page: what to set aside, what's
 * already set aside or paid, the shortfall and how much is covered. Shown only
 * with Schedule C turned on; on any error it simply stays out of the way.
 */
export function TaxReservePanel() {
  const year = Number(localToday().slice(0, 4));
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    load(year).then((d) => { if (active) setData(d); }).catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [year]);
  if (!data) return null;

  const { report, profile, ledger } = data;
  // Without saved details, the same flat 25% the tax estimate falls back to.
  const o = buildTaxOverview({ profile: profile || { reserve_mode: 'flat' }, year, businessProfit: report.books.netProfit, today: localToday(), forecast: report.books.forecast || null, reserveBalance: ledger.balance });
  const coverage = o.coverage === null ? null : Math.min(100, Math.round(o.coverage * 100));
  const items = [
    ['Recommended', usd(o.recommended), profile ? `${o.forecastChoice.label}, ${o.effectiveMode === 'flat' ? 'flat percentage' : o.effectiveMode}` : 'A flat 25% of projected profit'],
    ['Set aside', usd(o.reserveBalance), 'In your tax savings'],
    ['Paid', usd(o.estimatedPaid), 'Estimated payments'],
    ['Shortfall', usd(o.stillToSetAside), o.stillToSetAside > 0 ? 'Still to set aside' : 'Fully covered'],
  ];
  return <Panel title={`Tax reserve, ${year}`} sub="Money to keep back for this year's taxes on your reselling profit. Moving it aside never counts as an expense."
    right={<Link to="/schedule-c" className="text-xs text-[var(--dp-text-secondary)] underline">Open tax estimate</Link>}>
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([label, value, sub]) => <div key={label} className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label)]">{label}</dt>
        <dd className={`mt-1 text-lg font-bold tabular-nums ${label === 'Shortfall' && o.stillToSetAside > 0 ? 'text-[var(--dp-warning-text)]' : 'text-[var(--dp-text-primary)]'}`}>{value}</dd>
        <dd className="text-xs text-[var(--dp-text-muted)]">{sub}</dd>
      </div>)}
    </dl>
    {coverage !== null && <div className="mt-4">
      <div className="flex justify-between text-xs text-[var(--dp-text-secondary)]"><span>Covered</span><span className="tabular-nums">{coverage}%</span></div>
      <div role="progressbar" aria-label="Tax reserve covered" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage} className="mt-1">
        <GrowBar pct={coverage} color={coverage >= 100 ? 'var(--dp-green-text)' : 'var(--dp-warning-text)'} />
      </div>
    </div>}
    {!profile && <p className="mt-3 text-xs text-[var(--dp-text-muted)]">Add your tax details on the <Link to="/schedule-c" className="underline">tax estimate</Link> for a personalized number.</p>}
  </Panel>;
}
