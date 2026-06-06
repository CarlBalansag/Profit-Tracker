import React, { useState } from 'react';
import { useCreditCard } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import {
  CreditCard as CreditCardIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function statusStyle(status) {
  const s = (status || '').toUpperCase();
  if (STATUS_SOLD.includes(s)) return { color: 'var(--green)', bg: 'var(--green-bg)', border: 'var(--green-soft)' };
  if (STATUS_RETURN.includes(s)) return { color: 'var(--red)', bg: 'var(--red-bg)', border: 'var(--red)' };
  return { color: 'var(--yellow)', bg: 'var(--accent-bg)', border: 'var(--accent-soft)' };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const { color, bg, border } = statusStyle(status);
  return (
    <span style={{
      color, background: bg, border: `1px solid ${border}`,
      fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', padding: '2px 7px', borderRadius: '4px',
      whiteSpace: 'nowrap',
    }}>
      {status || 'Pending'}
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
        style={{ borderBottom: '1px solid var(--border-default)', cursor: 'pointer' }}
        className="hover:bg-(--bg-hover) transition-colors"
      >
        <td style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.product}
            </span>
            <StatusBadge status={item.status} />
          </div>
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
          ${fmt(item.cost)}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
          {isPending ? <span style={{ color: 'var(--text-muted)' }}>—</span> : `$${fmt(item.revenue)}`}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
          {isPending
            ? <span style={{ color: 'var(--text-muted)' }}>—</span>
            : isLoss
            ? <span style={{ color: 'var(--red)' }}>-${fmt(Math.abs(item.netPnl))}</span>
            : <span style={{ color: 'var(--green)' }}>+${fmt(item.netPnl)}</span>
          }
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: 'var(--green)' }}>
          +${fmt(item.cashback)}
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
          {item.lossToRedeem > 0
            ? <span style={{ color: 'var(--red)' }}>${fmt(item.lossToRedeem)}</span>
            : <span style={{ color: 'var(--text-muted)' }}>—</span>
          }
        </td>
        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
          <ChevronDown
            size={13}
            style={{
              color: 'var(--text-muted)',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          />
        </td>
      </tr>

      {expanded && (
        <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
          <td colSpan={7} style={{ padding: '0' }}>
            <div style={{
              background: 'var(--bg-elevated)',
              borderTop: '1px solid var(--border-default)',
              padding: '14px 16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px 24px',
            }}>
              {[
                { label: 'Cost Basis', value: `$${fmt(item.cost)}`, color: 'var(--text-primary)' },
                { label: 'Sale Revenue', value: isPending ? '—' : `$${fmt(item.revenue)}`, color: 'var(--text-primary)' },
                { label: 'Net P&L', value: isPending ? '—' : isLoss ? `-$${fmt(Math.abs(item.netPnl))}` : `+$${fmt(item.netPnl)}`, color: isPending ? 'var(--text-muted)' : isLoss ? 'var(--red)' : 'var(--green)' },
                { label: 'Cashback Rate', value: `${item.cashbackRate ?? 0}%`, color: 'var(--text-secondary)' },
                { label: 'Cashback Earned', value: `+$${fmt(item.cashback)}`, color: 'var(--green)' },
                { label: 'Cashback Redeemed', value: item.lossToRedeem > 0 ? `$${fmt(item.lossToRedeem)}` : '—', color: item.lossToRedeem > 0 ? 'var(--red)' : 'var(--text-muted)' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 3 }}>
                    {label}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color }}>
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
  const { data, isLoading } = useCreditCard(selectedMonth);

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

  // ── Derived values for active card ──
  const days = activeCard?.due_day ? daysUntilDue(activeCard.due_day) : null;
  const dueLabel = activeCard?.due_day ? dueDateLabel(activeCard.due_day) : null;
  const dueColor = days === null ? null : days <= 5 ? 'var(--red)' : days <= 10 ? 'var(--yellow)' : 'var(--green)';
  const dueBg = days === null ? null : days <= 5 ? 'var(--red-bg)' : days <= 10 ? 'rgba(var(--yellow),0.08)' : 'var(--green-bg)';
  const dueBorder = days === null ? null : days <= 5 ? 'var(--red)' : days <= 10 ? 'var(--yellow)' : 'var(--green-soft)';

  const creditLimit = activeCard?.credit_limit ?? 0;
  const totalSpend = activeCard?.totalSpend ?? 0;
  const utilPct = creditLimit > 0 ? Math.min((totalSpend / creditLimit) * 100, 100) : 0;
  const utilColor = utilPct < 40 ? 'var(--accent)' : utilPct < 70 ? 'var(--yellow)' : 'var(--red)';
  const utilTextColor = utilPct < 40 ? 'var(--accent)' : utilPct < 70 ? 'var(--yellow)' : 'var(--red)';

  const activeItems = activeCard?.items ?? [];
  const cashbackToRedeem = activeCard?.cashbackToRedeem ?? 0;
  const cashbackToKeep = activeCard?.cashbackToKeep ?? 0;
  const uncoveredLoss = activeCard?.uncoveredLoss ?? 0;
  const amountToPay = activeCard?.amountToPay ?? 0;
  const cashbackEarned = activeCard?.cashbackEarned ?? 0;
  const minPayment = activeCard?.min_payment_pct > 0 ? totalSpend * activeCard.min_payment_pct / 100 : null;

  // Topbar badge: pick the most urgent due date across all cards
  const urgentCard = cards.reduce((worst, c) => {
    if (!c.due_day) return worst;
    const d = daysUntilDue(c.due_day);
    if (!worst || d < daysUntilDue(worst.due_day)) return c;
    return worst;
  }, null);
  const urgentDays = urgentCard?.due_day ? daysUntilDue(urgentCard.due_day) : null;
  const urgentColor = urgentDays !== null ? (urgentDays <= 5 ? 'var(--red)' : urgentDays <= 10 ? 'var(--yellow)' : 'var(--green)') : null;
  const urgentBg = urgentDays !== null ? (urgentDays <= 5 ? 'var(--red-bg)' : urgentDays <= 10 ? 'rgba(255,200,50,0.06)' : 'var(--green-bg)') : null;
  const urgentBorder = urgentDays !== null ? (urgentDays <= 5 ? 'var(--red)' : urgentDays <= 10 ? 'var(--yellow)' : 'var(--green-soft)') : null;

  const totalKeep = summary.totalCashbackToKeep ?? 0;
  const totalUncovered = summary.totalUncoveredLoss ?? 0;

  const pill = (label, color, bg, border) => (
    <span key={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, border: `1px solid ${border}`,
      background: bg, color, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>

      {/* ── Topbar ── */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid var(--border-default)',
        background: 'var(--bg-surface)', flexShrink: 0, gap: 16,
      }}>
        {/* Left: title + month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
            Card Tracker
          </span>
          <span style={{ width: 1, height: 16, background: 'var(--border-hover)', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setSelectedMonth(prev => offsetMonth(prev, -1))}
              style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: '1px solid var(--border-hover)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <ChevronLeft size={12} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', minWidth: 108, textAlign: 'center' }}>
              {monthLabel}
            </span>
            <button
              onClick={() => setSelectedMonth(prev => offsetMonth(prev, 1))}
              disabled={isCurrentMonth}
              style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: '1px solid var(--border-hover)', color: isCurrentMonth ? 'var(--text-muted)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isCurrentMonth ? 'not-allowed' : 'pointer', opacity: isCurrentMonth ? 0.4 : 1 }}
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {/* Right: dynamic badge pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {totalKeep > 0 && pill(`Keep $${fmt(totalKeep)}`, 'var(--green)', 'var(--green-bg)', 'var(--green-soft)')}
          {urgentDays !== null && pill(`Due in ${urgentDays}d`, urgentColor, urgentBg, urgentBorder)}
          {totalUncovered > 0 && pill(`Loss $${fmt(totalUncovered)}`, 'var(--red)', 'var(--red-bg)', 'var(--red)')}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {cards.length === 0 ? (
          /* Empty state */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 48, color: 'var(--text-muted)' }}>
            <CreditCardIcon size={36} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>No credit cards set up</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 300 }}>
              Add a credit card payment method in Settings to start tracking spending and cashback.
            </div>
          </div>
        ) : (
          <>
            {/* ── Hero ── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              borderBottom: '1px solid var(--border-default)',
            }}>
              {/* Left: net to pay */}
              <div style={{ padding: '28px 24px', borderRight: '1px solid var(--border-default)' }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
                  Net to Pay · {activeCard?.name ?? 'All Cards'}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 42, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text-primary)', lineHeight: 1 }}>
                  ${fmt(amountToPay)}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                  {cashbackToRedeem > 0 && (
                    <span>Redeem <span style={{ color: 'var(--red)', fontWeight: 600, fontFamily: 'monospace' }}>${fmt(cashbackToRedeem)}</span> to cover losses</span>
                  )}
                  <span style={{ color: 'var(--text-muted)' }}>{cards.length} card{cards.length !== 1 ? 's' : ''} active</span>
                </div>
              </div>

              {/* Right: mini stats */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)' }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Total Spend</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>${fmt(totalSpend)}</div>
                  </div>
                  <CreditCardIcon size={18} style={{ color: 'var(--accent)', opacity: 0.5 }} />
                </div>
                <div style={{ flex: 1, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Cashback Earned</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>${fmt(cashbackEarned)}</div>
                  </div>
                  <Sparkles size={18} style={{ color: 'var(--green)', opacity: 0.5 }} />
                </div>
              </div>
            </div>

            {/* ── Card tabs ── */}
            <div style={{
              display: 'flex', gap: 0, overflowX: 'auto', borderBottom: '1px solid var(--border-default)',
              background: 'var(--bg-surface)', flexShrink: 0,
            }}>
              {cards.map(card => {
                const isActive = activeCard?.id === card.id;
                const cardDays = card.due_day ? daysUntilDue(card.due_day) : null;
                const cardDueLabel = card.due_day ? dueDateLabel(card.due_day) : null;
                return (
                  <button
                    key={card.id}
                    onClick={() => setActiveCardId(card.id)}
                    style={{
                      flex: '0 0 auto', minWidth: 160, padding: '10px 16px',
                      background: isActive ? 'var(--bg-elevated)' : 'transparent',
                      border: 'none', borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                      cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s',
                      borderRight: '1px solid var(--border-default)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                        background: 'var(--accent-bg)', border: '1px solid var(--border-hover)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <CreditCardIcon size={11} style={{ color: 'var(--accent)' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }}>
                        {card.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        {card.txnCount} item{card.txnCount !== 1 ? 's' : ''}
                        {cardDays !== null ? ` · Due ${cardDueLabel}` : ''}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        ${fmt(card.amountToPay)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── Utilization bar ── */}
            {activeCard && (creditLimit > 0 || days !== null || minPayment !== null) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px',
                borderBottom: '1px solid var(--border-default)', background: 'var(--bg-surface)',
                flexWrap: 'wrap', flexShrink: 0,
              }}>
                {creditLimit > 0 && (
                  <>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      Utilization
                    </span>
                    <div style={{ flex: '1 1 80px', maxWidth: 160, height: 4, background: 'var(--border-hover)', borderRadius: 2, overflow: 'hidden', minWidth: 60 }}>
                      <div style={{ width: `${utilPct}%`, height: '100%', background: utilColor, borderRadius: 2, transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: utilTextColor, whiteSpace: 'nowrap' }}>
                      {utilPct.toFixed(0)}%
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'monospace' }}>${fmt(totalSpend)}</span>
                      <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>/</span>
                      <span style={{ fontFamily: 'monospace' }}>${fmt(creditLimit)}</span>
                    </span>
                    <span style={{ width: 1, height: 12, background: 'var(--border-hover)', flexShrink: 0 }} />
                  </>
                )}
                {minPayment !== null && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    Min payment <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontWeight: 600 }}>${fmt(minPayment)}</span>
                  </span>
                )}
                {days !== null && minPayment !== null && (
                  <span style={{ width: 1, height: 12, background: 'var(--border-hover)', flexShrink: 0 }} />
                )}
                {days !== null && (
                  <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Due </span>
                    <span style={{ fontFamily: 'monospace', color: dueColor, fontWeight: 700 }}>
                      {days === 0 ? 'today' : `${days}d`}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}> · {dueLabel}</span>
                  </span>
                )}
              </div>
            )}

            {/* ── Alert banners ── */}
            {uncoveredLoss > 0 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 20px', background: 'var(--red-bg)',
                borderBottom: '1px solid var(--red)', flexShrink: 0,
              }}>
                <AlertTriangle size={14} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>
                  Uncovered Loss: <span style={{ fontFamily: 'monospace' }}>${fmt(uncoveredLoss)}</span>
                  <span style={{ fontWeight: 400, marginLeft: 8, opacity: 0.8 }}>— cashback wasn't enough to cover all losses on this card.</span>
                </span>
              </div>
            )}
            {cashbackToKeep > 0 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 20px', background: 'var(--accent-bg)',
                borderBottom: '1px solid var(--border-hover)', flexShrink: 0,
              }}>
                <Sparkles size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                  Keep <span style={{ fontFamily: 'monospace' }}>${fmt(cashbackToKeep)}</span> as Points
                  <span style={{ fontWeight: 400, marginLeft: 8, color: 'var(--text-secondary)' }}>— this cashback stays in your rewards balance after covering losses.</span>
                </span>
              </div>
            )}

            {/* ── Item table ── */}
            <div style={{ flex: 1, overflowX: 'auto' }}>
              {activeItems.length === 0 ? (
                <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <CreditCardIcon size={28} style={{ margin: '0 auto 12px', opacity: 0.25 }} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>No purchases this month</div>
                  <div style={{ fontSize: 12 }}>Transactions made with this card will appear here.</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-hover)' }}>
                      {['Item', 'Cost', 'Revenue', 'P&L', 'Cashback', 'Redeem', ''].map((h, i) => (
                        <th key={i} style={{
                          padding: '8px 12px', textAlign: i === 0 ? 'left' : i === 6 ? 'center' : 'right',
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: 'var(--text-muted)', background: 'var(--bg-surface)',
                          ...(i === 0 && { paddingLeft: 16 }),
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeItems.map((item, i) => (
                      <ItemRow key={`${item.id}-${item.saleId ?? i}`} item={item} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--border-hover)', background: 'var(--bg-elevated)' }}>
                      <td style={{ padding: '10px 16px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Card Total</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>${fmt(totalSpend)}</td>
                      <td style={{ padding: '10px 12px' }} />
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: activeCard?.totalLosses > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                        {activeCard?.totalLosses > 0 ? `-$${fmt(activeCard.totalLosses)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>${fmt(cashbackEarned)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: cashbackToRedeem > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                        {cashbackToRedeem > 0 ? `$${fmt(cashbackToRedeem)}` : '—'}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Bottom bar ── */}
      {cards.length > 0 && (
        <div style={{
          height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', borderTop: '1px solid var(--border-default)',
          background: 'var(--bg-surface)', flexShrink: 0, gap: 8,
        }}>
          {/* Left: summary pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', overflow: 'hidden' }}>
            {cashbackEarned > 0 && pill(`Earned $${fmt(cashbackEarned)}`, 'var(--green)', 'var(--green-bg)', 'var(--green-soft)')}
            {cashbackToRedeem > 0 && pill(`Redeem $${fmt(cashbackToRedeem)}`, 'var(--red)', 'var(--red-bg)', 'var(--red)')}
            {cashbackToKeep > 0 && pill(`Keep $${fmt(cashbackToKeep)}`, 'var(--accent)', 'var(--accent-bg)', 'var(--accent-soft)')}
            {uncoveredLoss > 0 && pill(`Uncovered $${fmt(uncoveredLoss)}`, 'var(--red)', 'var(--red-bg)', 'var(--red)')}
          </div>

          {/* Right: pay pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', borderRadius: 20,
            background: 'var(--accent-bg)', border: '1px solid var(--accent-soft)',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Pay</span>
            <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>${fmt(amountToPay)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default CreditCard;
