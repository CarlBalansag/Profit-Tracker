// The chosen card's purchases for the month, with how each one's cashback and
// profit are worked out.
import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, CreditCard as CreditCardIcon, Sparkles } from 'lucide-react';
import { recordStatusLabel } from '../../data/statusWorkflow';
import { pointsFromDollars, pointsUnit } from '../../utils/cardRewards';

// Points cards: the dollar figures are the points' dollar value
// (multiplier x point value); these show the points themselves.
const isPointsCard = (card) => card?.rewardType === 'points';
const pointsText = (card, dollars) => {
  const pts = pointsFromDollars(dollars, card.pointValueCents);
  return `${pts < 0 ? '-' : ''}${Math.abs(pts).toLocaleString('en-US')} ${pointsUnit(card.rewardsLabel)}`;
};
const multiplierText = (card, dollarRate) => {
  const cents = Number(card.pointValueCents) || 1;
  const x = Math.round(((Number(dollarRate) || 0) / cents) * 100) / 100;
  return `${x}x (≈${dollarRate ?? 0}% at ${cents}¢)`;
};
function fmt(n) {
  return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Signed dollars for rows that can be credits (store refunds): "−$104.00".
function money(n, { plus = false } = {}) {
  const value = n ?? 0;
  if (value < 0) return `−$${fmt(Math.abs(value))}`;
  return `${plus ? '+' : ''}$${fmt(value)}`;
}

const STATUS_SOLD = ['SOLD', 'PAID', 'COMPLETED', 'SHIPPED_OUT', 'AUTHENTICATION', 'PENDING_PAYMENT', 'IN_TRANSIT_OUT'];
const STATUS_RETURN = ['RETURNED', 'DISPUTED', 'CANCELLED'];
const STATUS_CREDIT = ['REFUND'];

function statusStyle(status) {
  const s = (status || '').toUpperCase();
  if (STATUS_SOLD.includes(s)) return { color: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-soft)' };
  if (STATUS_RETURN.includes(s)) return { color: 'var(--red)', bg: 'var(--red-bg)', border: 'var(--red)' };
  if (STATUS_CREDIT.includes(s)) return { color: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-soft)' };
  return { color: 'var(--yellow)', bg: 'var(--accent-bg)', border: 'var(--accent-soft)' };
}

function StatusBadge({ status }) {
  const { color, bg, border } = statusStyle(status);
  return (
    <span style={{
      color, background: bg, border: `1px solid ${border}`,
      fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', padding: '2px 7px', borderRadius: '4px',
      whiteSpace: 'nowrap',
    }}>
      {recordStatusLabel(status) || 'Pending'}
    </span>
  );
}

function ItemRow({ item, card }) {
  const points = isPointsCard(card);
  const [expanded, setExpanded] = useState(false);
  const isLoss = item.netPnl !== null && item.netPnl < 0;
  const isPending = item.revenue === null;

  return (
    <>
      <tr
        onClick={() => setExpanded(e => !e)}
        className="cursor-pointer border-b border-[color:var(--dp-border)] transition-[background] duration-150 hover:bg-[var(--dp-hover-bg)]"
      >
        <td style={{ padding: '12px 16px 12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.product}
            </span>
            <StatusBadge status={item.status} />
          </div>
        </td>
        <td data-label="Cost" style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'var(--text-secondary)' }}>
          <span style={item.cost < 0 ? { color: 'var(--green)' } : undefined}>{money(item.cost)}</span>
        </td>
        <td data-label="Revenue" style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'var(--text-secondary)' }}>
          {isPending ? <span style={{ color: 'var(--text-muted)' }}>—</span> : `$${fmt(item.revenue)}`}
        </td>
        <td data-label="P&amp;L" style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600 }}>
          {isPending
            ? <span style={{ color: 'var(--text-muted)' }}>—</span>
            : isLoss
            ? <span style={{ color: 'var(--red)' }}>-${fmt(Math.abs(item.netPnl))}</span>
            : <span style={{ color: 'var(--green)' }}>+${fmt(item.netPnl)}</span>
          }
        </td>
        <td data-label="Cashback" style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'var(--green)' }}>
          <span style={item.cashback < 0 ? { color: 'var(--red)' } : undefined}>{money(item.cashback, { plus: true })}</span>
          {points && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{pointsText(card, item.cashback)}</span>}
        </td>
        <td data-label="Redeem" style={{ padding: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
          {item.lossToRedeem > 0
            ? <span style={{ color: 'var(--red)' }}>${fmt(item.lossToRedeem)}</span>
            : <span style={{ color: 'var(--text-muted)' }}>—</span>
          }
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide details' : 'Show details'}
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
            style={{ display: 'inline-flex', padding: 4, margin: -4, background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            <ChevronDown
              size={13}
              style={{
                color: 'var(--text-muted)',
                transform: expanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-[color:var(--dp-border)]">
          <td colSpan={7} style={{ padding: '0' }}>
            <div style={{
              background: 'var(--dp-dash-well, var(--bg-elevated))',
              borderRadius: 12,
              margin: '0 0 12px',
              padding: '14px 16px',
              display: 'grid',
              // Three columns when they fit, two on a narrow phone, so no label
              // is ever squeezed narrower than its longest word.
              gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
              gap: '12px 16px',
            }}>
              {[
                { label: item.kind === 'refund' ? 'Refund credit' : 'Cost Basis', value: money(item.cost), color: item.cost < 0 ? 'var(--green)' : 'var(--text-primary)' },
                { label: 'Sale Revenue', value: isPending ? '—' : `$${fmt(item.revenue)}`, color: 'var(--text-primary)' },
                { label: 'Net P&L', value: isPending ? '—' : isLoss ? `-$${fmt(Math.abs(item.netPnl))}` : `+$${fmt(item.netPnl)}`, color: isPending ? 'var(--text-muted)' : isLoss ? 'var(--red)' : 'var(--green)' },
                points
                  ? { label: 'Points Rate', value: multiplierText(card, item.cashbackRate), color: 'var(--text-secondary)' }
                  : { label: 'Cashback Rate', value: `${item.cashbackRate ?? 0}%`, color: 'var(--text-secondary)' },
                points
                  ? { label: item.kind === 'refund' ? 'Points taken back' : 'Points Earned', value: `${pointsText(card, item.cashback)} ≈ ${money(item.cashback)}`, color: item.cashback < 0 ? 'var(--red)' : 'var(--green)' }
                  : { label: item.kind === 'refund' ? 'Cashback taken back' : 'Cashback Earned', value: money(item.cashback, { plus: true }), color: item.cashback < 0 ? 'var(--red)' : 'var(--green)' },
                { label: 'Cashback Redeemed', value: item.lossToRedeem > 0 ? `$${fmt(item.lossToRedeem)}` : '—', color: item.lossToRedeem > 0 ? 'var(--red)' : 'var(--text-muted)' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3, overflowWrap: 'normal', hyphens: 'none' }}>
                    {label}
                  </div>
                  <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600, color }}>
                    {value}
                  </div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border-default)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-secondary)' }}>How the math works:</strong>{' '}
                {points
                  ? `Cost × points per $1 = points earned, valued at ${card.pointValueCents ?? 1}¢ each (change it in Settings → Payment Methods). When sold at a loss, that value covers the minimum needed. The rest stays as points.`
                  : 'Cost × cashback rate = earned. When sold at a loss, cashback covers the minimum needed. Remaining cashback stays as points.'}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PurchasesPanel({ card: activeCard, monthLabel }) {
  const activeItems = activeCard?.items ?? [];
  const totalSpend = activeCard?.totalSpend ?? 0;
  const cashbackEarned = activeCard?.cashbackEarned ?? 0;
  const cashbackToRedeem = activeCard?.cashbackToRedeem ?? 0;
  const cashbackToKeep = activeCard?.cashbackToKeep ?? 0;
  const uncoveredLoss = activeCard?.uncoveredLoss ?? 0;

  return (
    <section id="card-purchases" aria-label={`Purchases on ${activeCard?.name}`} className="cc-purchases rounded-xl border border-gray-800 bg-[#12121A] p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--dp-text-primary)]">
          Purchases · {activeCard?.name}
        </h2>
        <span className="text-xs text-gray-500">{monthLabel}</span>
      </div>

      {/* ── Alerts ── */}
      {uncoveredLoss > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-[var(--dp-red-text)]">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span className="font-semibold">
            Uncovered Loss: <span className="tabular-nums">${fmt(uncoveredLoss)}</span>
            <span className="ml-2 font-normal opacity-80">— cashback wasn't enough to cover all losses on this card.</span>
          </span>
        </div>
      )}
      {cashbackToKeep > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-xs text-[var(--dp-green-text)]">
          <Sparkles size={14} className="mt-px shrink-0" />
          <span className="font-semibold">
            Keep <span className="tabular-nums">${fmt(cashbackToKeep)}</span> as Points
            <span className="ml-2 font-normal text-gray-400">— this cashback stays in your rewards balance after covering losses.</span>
          </span>
        </div>
      )}

      {/* ── Item table ── */}
      {activeItems.length === 0 ? (
        <div className="py-10 text-center">
          <CreditCardIcon size={28} className="mx-auto mb-3 text-gray-500" />
          <div className="mb-1 text-sm font-semibold text-gray-300">No purchases this month</div>
          <div className="text-xs text-gray-500">Transactions made with this card will appear here.</div>
        </div>
      ) : (
        <div className="overflow-x-auto dp-scrollbar">
          <table className="phone-cards w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[color:var(--dp-border)] text-[11px] font-medium uppercase tracking-[0.06em]">
                {['Item', 'Cost', 'Revenue', 'P&L', 'Cashback', 'Redeem', ''].map((h, i) => (
                  <th
                    key={i}
                    className={`pb-3 font-medium ${i === 0 ? 'pr-4 text-left' : i === 6 ? 'px-3 text-center' : 'px-3 text-right'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeItems.map((item, i) => (
                <ItemRow key={`${item.kind ?? 'item'}-${item.id}-${item.saleId ?? i}`} item={item} card={activeCard} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[color:var(--dp-border-hover)] font-bold tabular-nums">
                <td className="py-3 pr-4 text-[11px] uppercase tracking-[0.06em] text-gray-400">Card Total</td>
                <td data-label="Cost" className="px-3 py-3 text-right text-[var(--dp-text-primary)]">{money(totalSpend)}</td>
                <td className="px-3 py-3" />
                <td data-label="P&amp;L" className={`px-3 py-3 text-right ${activeCard?.totalLosses > 0 ? 'text-[var(--dp-red-text)]' : 'text-gray-500'}`}>
                  {activeCard?.totalLosses > 0 ? `-$${fmt(activeCard.totalLosses)}` : '—'}
                </td>
                <td data-label="Cashback" className="px-3 py-3 text-right text-[var(--dp-green-text)]">{money(cashbackEarned)}</td>
                <td data-label="Redeem" className={`px-3 py-3 text-right ${cashbackToRedeem > 0 ? 'text-[var(--dp-red-text)]' : 'text-gray-500'}`}>
                  {cashbackToRedeem > 0 ? `$${fmt(cashbackToRedeem)}` : '—'}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
