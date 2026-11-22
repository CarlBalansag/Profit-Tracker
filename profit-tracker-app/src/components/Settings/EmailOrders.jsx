import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useEmailAutomation, useEmailOrderMutations, useEmailOrders, useEmailRuleMutations } from '../../hooks/useApi';

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A] p-5 sm:p-6 space-y-4';
// Every automatic change is in Activity, with Undo.
const AUTOMATIONS = [
  ['linkMatches', 'Link sure matches without asking', 'Fills blank order and tracking numbers.'],
  ['updateShipping', 'Update purchases from shipping emails', 'Adds tracking and marks them delivered.'],
  ['returnReminders', 'Fill in return-by dates', "From the store's usual return window."],
  ['createPurchases', 'Create purchases from order emails', 'For orders still unmatched a day later.'],
  ['cancellations', 'Cancel purchases the store cancelled', 'Off: you get a To-Do instead.'],
];
const TABS = [['review', 'To check'], ['linked', 'Linked'], ['unmatched', 'No match'], ['dismissed', 'Not business']];
const MERCHANT = {
  amazon: 'Amazon', walmart: 'Walmart', bestbuy: 'Best Buy', target: 'Target', apple: 'Apple', costco: 'Costco',
  samsclub: "Sam's Club", homedepot: 'Home Depot', lowes: "Lowe's", gamestop: 'GameStop', nike: 'Nike', ebay: 'eBay',
  stockx: 'StockX', goat: 'GOAT', paypal: 'PayPal', pirateship: 'Pirate Ship',
};
const STATUS = { order: 'Ordered', receipt: 'Receipt', sale: 'Sold', shipped: 'Shipped', delivered: 'Delivered', pickup: 'Ready for pickup', cancelled: 'Cancelled', refund: 'Refunded', return: 'Returned', payout: 'Paid out' };
const RECORD = { purchase: 'purchase', sale: 'sale', expense: 'expense' };
const usd = (v) => (v == null ? null : Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

function Records({ match }) {
  const names = match.records.map((r) => `${r.quantity > 1 ? `${r.quantity} × ` : ''}${r.name}`).join(', ');
  const amount = match.records.reduce((t, r) => t + (r.amount || 0), 0);
  const date = match.records[0]?.date;
  return (
    <p className="text-sm text-gray-200">
      <span className="text-gray-500">{match.records.length > 1 ? `${match.records.length} ${RECORD[match.record_type]}s: ` : `Your ${RECORD[match.record_type]}: `}</span>
      {names} <span className="text-gray-500">· {usd(amount)} · {day(date)}</span>
    </p>
  );
}

function OrderRow({ order, tab }) {
  const { accept, reject, dismiss } = useEmailOrderMutations();
  const { addExpense, addPurchase, handled, saveInvoice } = useEmailRuleMutations();
  const match = order.matches.find((m) => (tab === 'linked' ? m.state === 'linked' : m.state === 'suggested'));
  const run = async (fn, arg, done) => {
    try { await fn.mutateAsync(arg); if (done) toast.success(done); } catch (err) { toast.error(err.message); }
  };
  const label = MERCHANT[order.merchant] || order.merchant;
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-gray-100">{label}</span>
        <span className="text-xs text-gray-500">
          {[order.order_number && `#${order.order_number}`, usd(order.total), day(order.first_seen)].filter(Boolean).join(' · ')}
        </span>
        {STATUS[order.status] && <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[11px] font-semibold text-gray-300">{STATUS[order.status]}</span>}
      </div>
      {match && <Records match={match} />}
      {order.attention && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--dp-warning-text)]">
          {order.attention === 'cancelled' ? 'The store cancelled this order. Cancel the purchase too, or change its quantity.' : 'This order was refunded or returned. Record the refund on the purchase.'}
          <button type="button" onClick={() => run(handled, order.id, 'Done')} className="underline">Done</button>
        </p>
      )}
      {match && tab === 'review' && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Why it looks like a match">
          {match.reasons.map((r) => (
            <li key={r.code} className={`rounded-md px-1.5 py-0.5 text-[11px] ${r.points < 0 ? 'bg-[var(--dp-warning-bg)] text-[var(--dp-warning-text)]' : 'bg-white/5 text-gray-400'}`}>{r.text}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {tab === 'review' && match && (
          <>
            <button type="button" onClick={() => run(accept, match.id, 'Linked')} className="page-btn page-btn-primary"><Check size={14} aria-hidden="true" /> Yes, link</button>
            <button type="button" onClick={() => run(reject, match.id)} className="page-btn page-btn-secondary"><X size={14} aria-hidden="true" /> Not this</button>
          </>
        )}
        {tab === 'linked' && match && (
          <>
            {match.auto && <span className="self-center text-xs text-gray-500">Linked automatically</span>}
            {order.has_invoice && ['purchase', 'expense'].includes(match.record_type) && (
              <button type="button" onClick={() => run(saveInvoice, order.id, 'Invoice saved as the receipt')} className="page-btn page-btn-secondary">Save invoice as receipt</button>
            )}
            <button type="button" onClick={() => run(reject, match.id, 'Unlinked')} className="page-btn page-btn-secondary">Unlink</button>
          </>
        )}
        {tab === 'unmatched' && order.type === 'purchase' && order.total != null && !['cancelled', 'refund', 'return'].includes(order.status) && (
          <button type="button" onClick={() => run(addPurchase, order.id, 'Purchase created')} className="page-btn page-btn-primary">Create purchase</button>
        )}
        {tab === 'unmatched' && order.type === 'receipt' && order.total != null && (
          <button type="button" onClick={() => run(addExpense, order.id, 'Added as an expense')} className="page-btn page-btn-primary">Add as expense</button>
        )}
        {(tab === 'unmatched' || tab === 'review') && (
          <button type="button" onClick={() => run(dismiss, { id: order.id }, 'Marked not business')} className="page-btn page-btn-secondary">Not business</button>
        )}
        {tab === 'dismissed' && (
          <button type="button" onClick={() => run(dismiss, { id: order.id, restore: true })} className="page-btn page-btn-secondary">Bring back</button>
        )}
      </div>
    </li>
  );
}

export function EmailOrders({ found }) {
  const [tab, setTab] = useState('review');
  const [limit, setLimit] = useState(20);
  const { data } = useEmailOrders({ state: tab, limit, found });
  const { data: automation } = useEmailAutomation();
  const { acceptAll, automation: saveAutomation } = useEmailOrderMutations();
  if (!found) return null;
  const counts = data?.counts || {};
  const orders = data?.orders || [];

  const acceptEverything = async () => {
    if (!window.confirm(`Link all ${counts.review} orders to the purchase each one looks like? You can unlink any of them later.`)) return;
    try { const r = await acceptAll.mutateAsync(); toast.success(`Linked ${r.linked}`); } catch (err) { toast.error(err.message); }
  };

  return (
    <section aria-labelledby="email-orders" className={PANEL}>
      <div>
        <h2 id="email-orders" className="text-sm font-bold text-white">Orders from email</h2>
        <p className="mt-1 max-w-prose text-xs text-gray-500">Each order is matched to your purchases, sales or expenses. Linking fills in blank order and tracking numbers; Undo is in Activity.</p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-gray-400">Automatic actions</summary>
        <div className="mt-1">
          {AUTOMATIONS.map(([key, label, hint]) => (
            <label key={key} className="flex min-h-[44px] items-center gap-3 text-sm text-gray-200">
              <input type="checkbox" checked={Boolean(automation?.[key])} onChange={(e) => saveAutomation.mutate({ [key]: e.target.checked })} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
              <span>{label}<span className="block text-xs text-gray-500">{hint}</span></span>
            </label>
          ))}
        </div>
      </details>
      <div role="group" aria-label="Show" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 dp-no-native-scrollbar">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => { setTab(key); setLimit(20); }}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium ${tab === key ? 'border-transparent bg-[var(--accent-bg)] text-[var(--accent)]' : 'border-[color:var(--dp-border)] text-gray-400'}`}>
            {label}{counts[key] ? ` (${counts[key]})` : ''}
          </button>
        ))}
      </div>
      {tab === 'review' && counts.review > 1 && (
        <button type="button" onClick={acceptEverything} disabled={acceptAll.isPending} className="page-btn page-btn-secondary">Link all {counts.review}</button>
      )}
      {orders.length === 0
        ? <p className="text-sm text-gray-500">{tab === 'review' ? 'Nothing to check.' : 'Nothing here.'}</p>
        : <ul className="divide-y divide-white/[0.06]">{orders.map((o) => <OrderRow key={o.id} order={o} tab={tab} />)}</ul>}
      {data?.total > orders.length && (
        <button type="button" onClick={() => setLimit((n) => Math.min(n + 20, 100))} className="page-btn page-btn-secondary">Show more ({data.total - orders.length} left)</button>
      )}
    </section>
  );
}
