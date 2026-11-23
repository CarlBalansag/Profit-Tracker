import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCashoutProviders } from '../../hooks/useApi';

// Settings > Notifications > Cashout deal alerts: a push when a cashout drops
// a new deal (api services/cashouts/dealAlerts.js), and which ones.

const ROW = 'flex min-h-[44px] items-center justify-between gap-4';
const INPUT = 'rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2 text-base sm:text-sm text-[var(--dp-text-primary)]';

// "Best Buy, Target" -> ["Best Buy", "Target"]
const parseStores = (text) => text.split(',').map((entry) => entry.trim()).filter(Boolean);

export default function DealAlertSettings({ settings, busy, change }) {
  const { data: providers = [] } = useCashoutProviders();
  const [quiet, setQuiet] = useState(Boolean(settings.deal_quiet_from && settings.deal_quiet_to));
  const chosen = settings.deal_providers || [];
  const on = settings.deal_alerts;

  const toggleProvider = (id, checked) => {
    // An empty list means every cashout, so "all ticked" is saved as empty.
    const current = chosen.length ? chosen : providers.map((provider) => provider.id);
    const next = checked ? [...new Set([...current, id])] : current.filter((entry) => entry !== id);
    if (!next.length) return;
    change({ deal_providers: next.length === providers.length ? [] : next });
  };

  const setQuietHours = (enabled) => {
    setQuiet(enabled);
    change(enabled ? { deal_quiet_from: '22:00', deal_quiet_to: '07:00' } : { deal_quiet_from: null, deal_quiet_to: null });
  };

  return (
    <section aria-labelledby="notif-deals" className="rounded-xl border border-gray-800 bg-[#12121A] p-5 sm:p-6 space-y-4">
      <div className={ROW}>
        <label htmlFor="notif-deal-alerts" className="min-w-0 flex-1 cursor-pointer">
          <span id="notif-deals" className="block text-sm font-bold text-white">Cashout deal alerts</span>
          <span className="block text-xs text-gray-500">
            A notification when ElectronicsBuyer, EarnFromBuying or Points4Days drops a new deal, with your profit using your best card. You don't need to be connected to a cashout to get its deals.
          </span>
        </label>
        <input id="notif-deal-alerts" type="checkbox" checked={on} disabled={busy} onChange={(e) => change({ deal_alerts: e.target.checked })} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
      </div>

      {on && (
        <div className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          <div className={`${ROW} py-2`}>
            <label htmlFor="notif-deal-min" className="min-w-0 flex-1">
              <span className="block text-sm text-gray-100">Minimum profit</span>
              <span className="block text-xs text-gray-500">Payout minus retail, plus your card's rewards. Deals with no retail price only come through at $0.</span>
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400" aria-hidden="true">$</span>
              <input
                id="notif-deal-min"
                type="number"
                inputMode="decimal"
                step="1"
                defaultValue={settings.deal_min_profit}
                key={`min-${settings.deal_min_profit}`}
                disabled={busy}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (e.target.value === '' || !Number.isFinite(value)) { e.target.value = settings.deal_min_profit; return; }
                  if (value !== settings.deal_min_profit) change({ deal_min_profit: value });
                }}
                className={`${INPUT} w-28`}
              />
            </div>
          </div>

          <fieldset className="py-3">
            <legend className="text-sm text-gray-100">Cashouts</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {providers.map((provider) => {
                const checked = !chosen.length || chosen.includes(provider.id);
                return (
                  <label key={provider.id} className="flex min-h-[44px] items-center gap-2 text-sm text-gray-200 cursor-pointer">
                    <input type="checkbox" checked={checked} disabled={busy || (checked && (chosen.length === 1 || providers.length === 1))} onChange={(e) => toggleProvider(provider.id, e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                    {provider.settingsName || provider.name}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="py-3 space-y-1.5">
            <label htmlFor="notif-deal-stores" className="block text-sm text-gray-100">Only these stores</label>
            <input
              id="notif-deal-stores"
              type="text"
              placeholder="All stores"
              defaultValue={(settings.deal_stores || []).join(', ')}
              key={`stores-${(settings.deal_stores || []).join('|')}`}
              disabled={busy}
              onBlur={(e) => {
                const next = parseStores(e.target.value);
                if (next.join('|') !== (settings.deal_stores || []).join('|')) change({ deal_stores: next });
              }}
              className={`${INPUT} w-full`}
            />
            <p className="text-xs text-gray-500">Separate with commas, e.g. Best Buy, Target. Leave empty for every store.</p>
          </div>

          <div className="pt-2">
            <div className={ROW}>
              <label htmlFor="notif-deal-quiet" className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-sm text-gray-100">Quiet hours</span>
                <span className="block text-xs text-gray-500">No deal notifications between these times (in {settings.timezone}). Deals still show under Cashout › New deals.</span>
              </label>
              <input id="notif-deal-quiet" type="checkbox" checked={quiet} disabled={busy} onChange={(e) => setQuietHours(e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
            </div>
            {quiet && settings.deal_quiet_from && (
              <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-gray-400">
                <label htmlFor="notif-deal-quiet-from">From</label>
                <input
                  id="notif-deal-quiet-from"
                  type="time"
                  defaultValue={settings.deal_quiet_from}
                  key={`from-${settings.deal_quiet_from}`}
                  disabled={busy}
                  onBlur={(e) => { if (e.target.value && e.target.value !== settings.deal_quiet_from) change({ deal_quiet_from: e.target.value, deal_quiet_to: settings.deal_quiet_to }); }}
                  className={`${INPUT} w-36`}
                />
                <label htmlFor="notif-deal-quiet-to">to</label>
                <input
                  id="notif-deal-quiet-to"
                  type="time"
                  defaultValue={settings.deal_quiet_to}
                  key={`to-${settings.deal_quiet_to}`}
                  disabled={busy}
                  onBlur={(e) => { if (e.target.value && e.target.value !== settings.deal_quiet_to) change({ deal_quiet_from: settings.deal_quiet_from, deal_quiet_to: e.target.value }); }}
                  className={`${INPUT} w-36`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <p className="border-t border-white/[0.06] pt-3 text-xs text-gray-500">
        See the latest under <Link to="/cashout?tab=new-deals" className="underline underline-offset-2 hover:text-gray-300">Cashout › New deals</Link>.
      </p>
    </section>
  );
}
