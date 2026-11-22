import React, { useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useEmailMessages } from '../../hooks/useApi';

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A] p-5 sm:p-6 space-y-4';

const FILTERS = [['all', 'All'], ['orders', 'Orders'], ['shipping', 'Shipping'], ['sales', 'Sales'], ['problems', 'Cancels & refunds']];
const KIND_LABEL = {
  order: 'Order', receipt: 'Receipt', shipped: 'Shipped', delivered: 'Delivered', pickup: 'Ready for pickup',
  cancelled: 'Cancelled', refund: 'Refund', return: 'Return', sale: 'Sale', payout: 'Payout', other: 'Other',
};
const MERCHANT = {
  amazon: 'Amazon', walmart: 'Walmart', bestbuy: 'Best Buy', target: 'Target', apple: 'Apple', costco: 'Costco',
  samsclub: "Sam's Club", homedepot: 'Home Depot', lowes: "Lowe's", gamestop: 'GameStop', nike: 'Nike', ebay: 'eBay',
  stockx: 'StockX', goat: 'GOAT', paypal: 'PayPal', pirateship: 'Pirate Ship', ups: 'UPS', fedex: 'FedEx', usps: 'USPS',
  points4days: 'Points4Days',
};
const usd = (v) => (v == null ? null : Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
// Below this, a value is shown with "check" so nobody trusts a guess.
const SURE = 0.6;

function Detail({ label, value, confidence }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right tabular-nums text-gray-200">
        {value}{confidence != null && confidence < SURE && <span className="ml-1.5 text-[11px] text-[var(--dp-warning-text)]">check</span>}
      </dd>
    </div>
  );
}

function MessageRow({ m }) {
  const [open, setOpen] = useState(false);
  const c = m.confidence || {};
  const facts = [m.order_number && `#${m.order_number}`, usd(m.total), m.tracking_numbers?.length ? `${m.tracking_numbers.length} tracking` : null].filter(Boolean);
  return (
    <li className="py-2.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-gray-100">{MERCHANT[m.merchant] || m.from_name || 'Email'}</span>
            {m.kind && <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-semibold text-gray-300">{KIND_LABEL[m.kind] || m.kind}</span>}
            {m.status === 'failed' && <span className="rounded-md bg-[var(--dp-warning-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--dp-warning-text)]">Couldn't read</span>}
          </div>
          <p className="truncate text-xs text-gray-500">{facts.length ? facts.join(' · ') : m.subject || '(no subject)'}</p>
        </div>
        <span className="shrink-0 pt-0.5 text-xs text-gray-500">{day(m.sent_at)}</span>
        <ChevronDown size={16} aria-hidden="true" className={`mt-0.5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-xs text-gray-400">{m.subject}</p>
          {m.extract_error && <p className="text-xs text-[var(--dp-warning-text)]">{m.extract_error}</p>}
          <dl className="max-w-md divide-y divide-white/[0.06] text-xs">
            <Detail label="Order #" value={m.order_number} confidence={c.order_number} />
            <Detail label="Subtotal" value={usd(m.subtotal)} confidence={c.subtotal} />
            <Detail label="Discount" value={m.discount != null ? `−${usd(m.discount)}` : null} confidence={c.discount} />
            <Detail label="Shipping" value={usd(m.shipping)} confidence={c.shipping} />
            <Detail label="Tax" value={usd(m.tax)} confidence={c.tax} />
            <Detail label="Total" value={usd(m.total)} confidence={c.total} />
            <Detail label="Paid with" value={m.payment_hint} confidence={c.payment_hint} />
            <Detail label="Tracking" value={m.tracking_numbers?.join(', ') || null} />
          </dl>
          {Array.isArray(m.items) && m.items.length > 0 && (
            <div>
              <p className="text-xs text-gray-500">Items{c.items != null && c.items < SURE && <span className="ml-1.5 text-[11px] text-[var(--dp-warning-text)]">check</span>}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-gray-300">
                {m.items.map((it, i) => (
                  <li key={`${i}-${it.name}`} className="flex justify-between gap-4"><span className="min-w-0 truncate">{it.quantity ? `${it.quantity} × ` : ''}{it.name}</span><span className="shrink-0 tabular-nums">{usd(it.total)}</span></li>
                ))}
              </ul>
            </div>
          )}
          {m.link && <a href={m.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">Open in Gmail <ExternalLink size={11} aria-hidden="true" /></a>}
        </div>
      )}
    </li>
  );
}

export function FoundInEmail({ found }) {
  const [kind, setKind] = useState('all');
  const [limit, setLimit] = useState(10);
  const { data } = useEmailMessages({ limit, kind, found });
  const messages = data?.messages || [];
  const total = data?.total || 0;
  if (!found) return null;

  return (
    <section aria-labelledby="email-found" className={PANEL}>
      <div>
        <h2 id="email-found" className="text-sm font-bold text-white">Found in email</h2>
        <p className="mt-1 text-xs text-gray-500">Details read from your store emails. Newsletters are left out.</p>
      </div>
      <div role="group" aria-label="Show" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 dp-no-native-scrollbar">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={kind === key} onClick={() => { setKind(key); setLimit(10); }}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${kind === key ? 'border-transparent bg-[var(--accent-bg)] text-[var(--accent)]' : 'border-[color:var(--dp-border)] text-gray-400'}`}>
            {label}
          </button>
        ))}
      </div>
      {messages.length === 0
        ? <p className="text-sm text-gray-500">Nothing here yet.</p>
        : <ul className="divide-y divide-white/[0.06]">{messages.map((m) => <MessageRow key={m.id} m={m} />)}</ul>}
      {total > messages.length && (
        <button type="button" onClick={() => setLimit((n) => Math.min(n + 20, 100))} className="page-btn page-btn-secondary">
          Show more ({total - messages.length} left)
        </button>
      )}
    </section>
  );
}
