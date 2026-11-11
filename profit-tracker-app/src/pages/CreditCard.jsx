import React, { useState } from 'react';
import { useCreditCard } from '../hooks/useApi';
import { recordStatusLabel } from '../data/statusWorkflow';
import { PageLoader } from '../components/PageLoader';
import LoadError from '../components/UI/LoadError';
import {
  CreditCard as CreditCardIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Sparkles,
  ShoppingCart,
  PiggyBank,
} from 'lucide-react';
import StatCard from '../components/UI/StatCard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Signed dollars for rows that can be credits (store refunds): "−$104.00".
function money(n, { plus = false } = {}) {
  const value = n ?? 0;
  if (value < 0) return `−$${fmt(Math.abs(value))}`;
  return `${plus ? '+' : ''}$${fmt(value)}`;
}

function toMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function offsetMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return toMonthKey(d);
}

function daysUntilDue(dueDay) {
  if (!dueDay) return null;
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const target = thisMonth > now ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function dueDateLabel(dueDay) {
  if (!dueDay) return null;
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const target = thisMonth > now ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

const PILL_TONES = {
  green: 'border-green-500/30 bg-green-500/10 text-[var(--dp-green-text)]',
  red: 'border-red-500/30 bg-red-500/10 text-[var(--dp-red-text)]',
  amber: 'border-amber-500/30 bg-amber-500/10 text-[var(--dp-warning-text)]',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function ItemRow({ item }) {
  const [expanded, setExpanded] = useState(false);
  const isLoss = item.netPnl !== null && item.netPnl < 0;
  const isProfit = item.netPnl !== null && item.netPnl >= 0;
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
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px 24px',
            }}>
              {[
                { label: item.kind === 'refund' ? 'Refund credit' : 'Cost Basis', value: money(item.cost), color: item.cost < 0 ? 'var(--green)' : 'var(--text-primary)' },
                { label: 'Sale Revenue', value: isPending ? '—' : `$${fmt(item.revenue)}`, color: 'var(--text-primary)' },
                { label: 'Net P&L', value: isPending ? '—' : isLoss ? `-$${fmt(Math.abs(item.netPnl))}` : `+$${fmt(item.netPnl)}`, color: isPending ? 'var(--text-muted)' : isLoss ? 'var(--red)' : 'var(--green)' },
                { label: 'Cashback Rate', value: `${item.cashbackRate ?? 0}%`, color: 'var(--text-secondary)' },
                { label: item.kind === 'refund' ? 'Cashback taken back' : 'Cashback Earned', value: money(item.cashback, { plus: true }), color: item.cashback < 0 ? 'var(--red)' : 'var(--green)' },
                { label: 'Cashback Redeemed', value: item.lossToRedeem > 0 ? `$${fmt(item.lossToRedeem)}` : '—', color: item.lossToRedeem > 0 ? 'var(--red)' : 'var(--text-muted)' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
                    {label}
                  </div>
                  <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600, color }}>
                    {value}
                  </div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border-default)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--text-secondary)' }}>How the math works:</strong> Cost × cashback rate = earned. When sold at a loss, cashback covers the minimum needed. Remaining cashback stays as points.
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function CreditCard() {
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthKey(new Date()));
  const [activeCardId, setActiveCardId] = useState(null);
  const { data, isLoading, isLoadingError, refetch } = useCreditCard(selectedMonth);

  const monthLabel = monthKeyToLabel(selectedMonth);
  const isCurrentMonth = selectedMonth === toMonthKey(new Date());

  const cards = data?.cards ?? [];
  const summary = data?.summary ?? {};

  // Pick active card — default to first card with spend, else first card
  const activeCard = (() => {
    if (!cards.length) return null;
    if (activeCardId) {
      const found = cards.find(c => c.id === activeCardId);
      if (found) return found;
    }
    return cards.find(c => c.totalSpend > 0) ?? cards[0];
  })();

  if (isLoading) return <PageLoader variant="generic" />;
  if (isLoadingError) return <LoadError title="Credit Card" what="your credit cards" onRetry={() => refetch()} />;

  // ── Derived values for active card ──
  const days = activeCard?.due_day ? daysUntilDue(activeCard.due_day) : null;
  const dueLabel = activeCard?.due_day ? dueDateLabel(activeCard.due_day) : null;
  const dueColor = days === null ? null : days <= 5 ? 'var(--red)' : days <= 10 ? 'var(--yellow)' : 'var(--green)';

  const creditLimit = activeCard?.credit_limit ?? 0;
  const totalSpend = activeCard?.totalSpend ?? 0;
  // A refund-only month can net to a credit; utilization never goes below 0%.
  const utilPct = creditLimit > 0 ? Math.max(0, Math.min((totalSpend / creditLimit) * 100, 100)) : 0;
  const utilColor = utilPct < 40 ? 'var(--accent)' : utilPct < 70 ? 'var(--yellow)' : 'var(--red)';

  const activeItems = activeCard?.items ?? [];
  const cashbackToRedeem = activeCard?.cashbackToRedeem ?? 0;
  const cashbackToKeep = activeCard?.cashbackToKeep ?? 0;
  const uncoveredLoss = activeCard?.uncoveredLoss ?? 0;
  const amountToPay = activeCard?.amountToPay ?? 0;
  const cashbackEarned = activeCard?.cashbackEarned ?? 0;
  const minPayment = activeCard?.min_payment_pct > 0 ? Math.max(0, totalSpend * activeCard.min_payment_pct / 100) : null;

  // Topbar badge: pick the most urgent due date across all cards
  const urgentCard = cards.reduce((worst, c) => {
    if (!c.due_day) return worst;
    const d = daysUntilDue(c.due_day);
    if (!worst || d < daysUntilDue(worst.due_day)) return c;
    return worst;
  }, null);
  const urgentDays = urgentCard?.due_day ? daysUntilDue(urgentCard.due_day) : null;
  const urgentTone = urgentDays === null ? null : urgentDays <= 5 ? 'red' : urgentDays <= 10 ? 'amber' : 'green';

  const totalKeep = summary.totalCashbackToKeep ?? 0;
  const totalUncovered = summary.totalUncoveredLoss ?? 0;

  const pill = (label, tone, title) => (
    <span
      key={label}
      title={title}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.05em] ${PILL_TONES[tone]}`}
    >
      {label}
    </span>
  );

  return (
    // The app shell never scrolls; each page owns its scroll container.
    <div className="h-full overflow-auto">
    <div className="w-full max-w-6xl mx-auto space-y-6 pb-10 px-4 py-6 sm:px-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Credit Card</h1>
          <p className="text-sm text-gray-400 mt-1">What each card owes this month and how cashback covers losses</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totalKeep > 0 && pill(`All Cards · Keep $${fmt(totalKeep)}`, 'green', 'Total cashback to keep across every active card for the selected month.')}
          {urgentDays !== null && pill(`Due in ${urgentDays}d`, urgentTone)}
          {totalUncovered > 0 && pill(`Loss $${fmt(totalUncovered)}`, 'red')}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelectedMonth(prev => offsetMonth(prev, -1))}
              aria-label="Previous month"
              className="page-btn page-btn-secondary page-btn-sm page-btn-icon"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="min-w-[120px] text-center text-sm font-semibold text-[var(--dp-text-primary)]">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => setSelectedMonth(prev => offsetMonth(prev, 1))}
              aria-label="Next month"
              disabled={isCurrentMonth}
              className="page-btn page-btn-secondary page-btn-sm page-btn-icon disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {cards.length === 0 ? (
        /* Empty state */
        <div className="rounded-xl border border-gray-800 bg-[#12121A] p-10 text-center">
          <CreditCardIcon size={32} className="mx-auto mb-3 text-gray-500" />
          <div className="text-sm font-semibold text-gray-300">No credit cards set up</div>
          <div className="mx-auto mt-1 max-w-xs text-xs text-gray-500">
            Add a credit card payment method in Settings to start tracking spending and cashback.
          </div>
        </div>
      ) : (
        <>
          {/* ── KPI cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label={`Net to Pay · ${activeCard?.name ?? 'All Cards'}`}
              value={money(amountToPay)}
              sub={cashbackToRedeem > 0
                ? `after redeeming $${fmt(cashbackToRedeem)} to cover losses`
                : `${cards.length} card${cards.length !== 1 ? 's' : ''} active`}
              icon={CreditCardIcon}
            />
            <StatCard
              label="Total Spend"
              value={money(totalSpend)}
              sub={`${activeCard?.txnCount ?? 0} item${activeCard?.txnCount !== 1 ? 's' : ''} this month`}
              icon={ShoppingCart}
              tone="accent"
            />
            <StatCard
              label="Cashback Earned"
              value={money(cashbackEarned)}
              sub={cashbackToRedeem > 0 ? `$${fmt(cashbackToRedeem)} redeemed for losses` : 'none needed for losses'}
              icon={Sparkles}
              tone="green"
            />
            <StatCard
              label="Keep as Points"
              value={money(cashbackToKeep)}
              sub={uncoveredLoss > 0 ? `$${fmt(uncoveredLoss)} loss not covered` : 'stays in your rewards balance'}
              icon={PiggyBank}
              tone={uncoveredLoss > 0 ? 'red' : 'green'}
            />
          </div>

          {/* ── Card picker ── */}
          <div className="space-y-3">
            <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider ml-1">Your Cards</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {cards.map(card => {
                const isActive = activeCard?.id === card.id;
                const cardDays = card.due_day ? daysUntilDue(card.due_day) : null;
                const cardDueLabel = card.due_day ? dueDateLabel(card.due_day) : null;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setActiveCardId(card.id)}
                    aria-pressed={isActive}
                    className={`relative w-full min-w-0 rounded-xl border p-4 text-left transition-all bg-[#12121A] border-white/10 dp-clickable-card ${isActive ? 'dp-card-selected' : ''}`}
                  >
                    <div className="mb-3 flex items-center gap-2.5 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--dp-accent-bg)]">
                        <CreditCardIcon size={15} className="text-[var(--dp-accent-light)]" />
                      </span>
                      <span className="truncate text-sm font-semibold text-[var(--dp-text-primary)]" title={card.name}>
                        {card.name}
                      </span>
                    </div>
                    <div className="text-lg font-bold tabular-nums text-[var(--dp-text-primary)]">{money(card.amountToPay)}</div>
                    <div className="mt-0.5 truncate text-[11px] text-gray-500">
                      {card.txnCount} item{card.txnCount !== 1 ? 's' : ''}
                      {cardDays !== null ? ` · Due ${cardDueLabel}` : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Purchases panel ── */}
          <div className="rounded-xl border border-gray-800 bg-[#12121A] p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--dp-text-primary)]">
                Purchases · {activeCard?.name}
              </h3>

              {/* Utilization, minimum payment and due date */}
              {activeCard && (creditLimit > 0 || days !== null || minPayment !== null) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
                  {creditLimit > 0 && (
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="font-semibold uppercase tracking-wider">Utilization</span>
                      <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-[var(--dp-border-hover)]">
                        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${utilPct}%`, background: utilColor }} />
                      </span>
                      <span className="font-semibold tabular-nums" style={{ color: utilColor }}>{utilPct.toFixed(0)}%</span>
                      <span className="tabular-nums">{money(totalSpend)} / ${fmt(creditLimit)}</span>
                    </span>
                  )}
                  {minPayment !== null && (
                    <span className="whitespace-nowrap">
                      Min payment <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">${fmt(minPayment)}</span>
                    </span>
                  )}
                  {days !== null && (
                    <span className="whitespace-nowrap">
                      Due <span className="font-bold tabular-nums" style={{ color: dueColor }}>{days === 0 ? 'today' : `${days}d`}</span> · {dueLabel}
                    </span>
                  )}
                </div>
              )}
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
                      <ItemRow key={`${item.kind ?? 'item'}-${item.id}-${item.saleId ?? i}`} item={item} />
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
          </div>
        </>
      )}
    </div>
    </div>
  );
}

export default CreditCard;
