import React, { useState } from 'react';
import { useCreditCard } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import {
  CreditCard as CreditCardIcon,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  TrendingDown,
  Gift,
  AlertTriangle,
  CheckCircle2,
  Wallet,
} from 'lucide-react';

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

function StatusBadge({ status }) {
  const s = (status || '').toUpperCase();
  const isPending = ['PURCHASED', 'LISTED', 'SHIPPED_IN', 'DELIVERED', 'SCANNED_IN', 'ON HAND', 'PRE ORDER'].includes(s);
  const isSold = ['SOLD', 'PAID', 'COMPLETED', 'SHIPPED_OUT', 'AUTHENTICATION', 'PENDING_PAYMENT', 'IN_TRANSIT_OUT'].includes(s);
  const isReturn = ['RETURNED', 'DISPUTED', 'CANCELLED'].includes(s);

  const color = isPending
    ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
    : isSold
    ? 'text-green-400 bg-green-500/10 border-green-500/30'
    : isReturn
    ? 'text-red-400 bg-red-500/10 border-red-500/30'
    : 'text-gray-400 bg-gray-500/10 border-gray-500/30';

  const label = isPending ? (status || 'Pending') : (status || 'Unknown');

  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${color}`}>
      {label}
    </span>
  );
}

function CardRow({ card }) {
  const [expanded, setExpanded] = useState(false);

  const hasLosses = card.totalLosses > 0;
  const hasUncovered = card.uncoveredLoss > 0;

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden" style={{ backgroundColor: 'var(--accent-bg)' }}>
      {/* Card Header */}
      <button
        className="w-full text-left px-5 py-4 hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left: card name + counts */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
              <CreditCardIcon size={16} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-white text-sm truncate">{card.name}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                {card.txnCount} purchase{card.txnCount !== 1 ? 's' : ''}
                {card.soldCount > 0 && ` · ${card.soldCount} sold`}
                {card.pendingCount > 0 && ` · ${card.pendingCount} pending`}
              </div>
            </div>
          </div>

          {/* Right: key figures */}
          <div className="flex items-center gap-6 flex-shrink-0">
            {/* Spend */}
            <div className="text-right hidden sm:block">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Spent</div>
              <div className="text-sm font-bold text-blue-400">${fmt(card.totalSpend)}</div>
            </div>

            {/* Cashback earned */}
            {card.cashbackEarned > 0 && (
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Cashback</div>
                <div className="text-sm font-bold text-green-400">+${fmt(card.cashbackEarned)}</div>
              </div>
            )}

            {/* Losses */}
            {hasLosses && (
              <div className="text-right hidden md:block">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Losses</div>
                <div className="text-sm font-bold text-red-400">-${fmt(card.totalLosses)}</div>
              </div>
            )}

            {/* Net to pay — always prominent */}
            <div className="text-right">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Pay Card</div>
              <div className="text-base font-bold text-white">${fmt(card.amountToPay)}</div>
            </div>

            {/* Expand chevron */}
            <div className="text-gray-500">
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
          </div>
        </div>

        {/* Cashback breakdown chips — always visible */}
        {(card.cashbackEarned > 0 || hasLosses) && (
          <div className="flex flex-wrap gap-2 mt-3">
            {card.cashbackEarned > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border border-green-500/30 bg-green-500/5 text-green-400">
                <Gift size={10} />
                ${fmt(card.cashbackEarned)} earned
              </span>
            )}

            {card.cashbackToRedeem > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border border-orange-500/30 bg-orange-500/5 text-orange-400">
                <TrendingDown size={10} />
                Redeem ${fmt(card.cashbackToRedeem)} to cover loss
              </span>
            )}

            {card.cashbackToKeep > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border border-purple-500/30 bg-purple-500/5 text-purple-400">
                <CheckCircle2 size={10} />
                Keep ${fmt(card.cashbackToKeep)} as points
              </span>
            )}

            {hasUncovered && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400">
                <AlertTriangle size={10} />
                ${fmt(card.uncoveredLoss)} loss uncovered
              </span>
            )}
          </div>
        )}
      </button>

      {/* Expanded item table */}
      {expanded && (
        <div className="border-t border-gray-800">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800/60">
                  <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Product</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Cost</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Revenue</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Net P&L</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Cashback</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Redeem</th>
                  <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {card.items.map((item, i) => {
                  const isLoss = item.netPnl !== null && item.netPnl < 0;
                  const isProfit = item.netPnl !== null && item.netPnl >= 0;
                  const isPending = item.revenue === null;

                  return (
                    <tr key={`${item.id}-${item.saleId ?? i}`} className="border-b border-gray-800/40 hover:bg-white/[0.015] transition-colors">
                      <td className="px-5 py-3 text-gray-300 font-medium max-w-[200px] truncate">{item.product}</td>
                      <td className="px-3 py-3 text-right text-gray-400">${fmt(item.cost)}</td>
                      <td className="px-3 py-3 text-right">
                        {isPending
                          ? <span className="text-gray-600">—</span>
                          : <span className="text-gray-300">${fmt(item.revenue)}</span>
                        }
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">
                        {isPending
                          ? <span className="text-gray-600">—</span>
                          : isLoss
                          ? <span className="text-red-400">-${fmt(Math.abs(item.netPnl))}</span>
                          : <span className="text-green-400">+${fmt(item.netPnl)}</span>
                        }
                      </td>
                      <td className="px-3 py-3 text-right text-green-400">+${fmt(item.cashback)}</td>
                      <td className="px-3 py-3 text-right">
                        {item.lossToRedeem > 0
                          ? <span className="text-orange-400">${fmt(item.lossToRedeem)}</span>
                          : <span className="text-gray-600">—</span>
                        }
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Card totals footer */}
              <tfoot>
                <tr className="border-t border-gray-700/60 bg-white/[0.02]">
                  <td className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">Card Total</td>
                  <td className="px-3 py-3 text-right text-sm font-bold text-blue-400">${fmt(card.totalSpend)}</td>
                  <td className="px-3 py-3" />
                  <td className="px-3 py-3 text-right text-sm font-bold">
                    {card.totalLosses > 0
                      ? <span className="text-red-400">-${fmt(card.totalLosses)}</span>
                      : <span className="text-green-400/50">No losses</span>
                    }
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-bold text-green-400">+${fmt(card.cashbackEarned)}</td>
                  <td className="px-3 py-3 text-right text-sm font-bold text-orange-400">
                    {card.cashbackToRedeem > 0 ? `$${fmt(card.cashbackToRedeem)}` : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="text-sm font-bold text-white">Pay: ${fmt(card.amountToPay)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CreditCard() {
  const [selectedMonth, setSelectedMonth] = useState(() => toMonthKey(new Date()));
  const { data, isLoading: loading, refetch } = useCreditCard(selectedMonth);
  const monthLabel = monthKeyToLabel(selectedMonth);
  const isCurrentMonth = selectedMonth === toMonthKey(new Date());

  const cards = data?.cards ?? [];
  const summary = data?.summary ?? {};

  if (loading) return <PageLoader variant="generic" />;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-10 px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Credit Card Tracker</h1>
          <p className="text-sm text-gray-400 mt-1">
            Monthly spending &amp; cashback breakdown
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Month navigation */}
          <div className="flex items-center gap-1 bg-gray-800/60 border border-gray-700/60 rounded-lg p-1">
            <button
              onClick={() => setSelectedMonth(prev => offsetMonth(prev, -1))}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              title="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2 text-sm font-medium text-white min-w-[120px] text-center">
              {monthLabel}
            </span>
            <button
              onClick={() => setSelectedMonth(prev => offsetMonth(prev, 1))}
              disabled={isCurrentMonth}
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <button
            onClick={refetch}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            <RotateCcw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Spend */}
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: 'var(--accent-bg)' }}>
          <div>
            <h3 className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2">Total Spend</h3>
            <div className="text-xl font-bold text-blue-400">${fmt(summary.totalSpend)}</div>
            <p className="text-[10px] text-blue-400/60 mt-1">{cards.length} card{cards.length !== 1 ? 's' : ''} used</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center bg-blue-500/10">
            <CreditCardIcon size={14} className="text-blue-400" />
          </div>
        </div>

        {/* Cashback Earned */}
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: 'var(--green-bg, var(--accent-bg))' }}>
          <div>
            <h3 className="text-[10px] font-bold text-green-400 uppercase tracking-wider mb-2">Cashback Earned</h3>
            <div className="text-xl font-bold text-green-400">${fmt(summary.totalCashbackEarned)}</div>
            <p className="text-[10px] text-green-400/60 mt-1">across all cards</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-green-500/30 flex items-center justify-center bg-green-500/10">
            <Gift size={14} className="text-green-400" />
          </div>
        </div>

        {/* Cashback to Redeem */}
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: 'var(--accent-bg)' }}>
          <div>
            <h3 className="text-[10px] font-bold text-orange-400 uppercase tracking-wider mb-2">Redeem</h3>
            <div className="text-xl font-bold text-orange-400">${fmt(summary.totalCashbackToRedeem)}</div>
            <p className="text-[10px] text-orange-400/60 mt-1">to cover losses</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-orange-500/30 flex items-center justify-center bg-orange-500/10">
            <TrendingDown size={14} className="text-orange-400" />
          </div>
        </div>

        {/* Net to Pay */}
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: 'var(--accent-bg)' }}>
          <div>
            <h3 className="text-[10px] font-bold text-white uppercase tracking-wider mb-2">Net to Pay</h3>
            <div className="text-xl font-bold text-white">${fmt(summary.totalAmountToPay)}</div>
            <p className="text-[10px] text-gray-500 mt-1">after redeeming cashback</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-gray-600/30 flex items-center justify-center bg-gray-600/10">
            <Wallet size={14} className="text-gray-300" />
          </div>
        </div>
      </div>

      {/* Uncovered loss alert */}
      {(summary.totalUncoveredLoss ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-400">Uncovered Loss: ${fmt(summary.totalUncoveredLoss)}</p>
            <p className="text-xs text-red-400/70 mt-0.5">
              Your cashback wasn&apos;t enough to fully cover your losses this month. This remaining amount comes out of pocket.
            </p>
          </div>
        </div>
      )}

      {/* Keep as points note */}
      {(summary.totalCashbackToKeep ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-purple-500/30 bg-purple-500/5 px-5 py-4">
          <CheckCircle2 size={16} className="text-purple-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-purple-400">Keep ${fmt(summary.totalCashbackToKeep)} as Points</p>
            <p className="text-xs text-purple-400/70 mt-0.5">
              After covering your losses, this cashback stays in your rewards balance. No need to redeem it.
            </p>
          </div>
        </div>
      )}

      {/* Per-card breakdown */}
      <div className="space-y-3">
        <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">By Card</h2>

        {cards.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-[var(--accent-bg)] p-12 text-center">
            <CreditCardIcon size={32} className="text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No credit card purchases in {monthLabel}</p>
            <p className="text-gray-600 text-sm mt-1">
              Add transactions with a credit card payment method to see your spending breakdown here.
            </p>
          </div>
        ) : (
          cards.map(card => <CardRow key={card.id} card={card} />)
        )}
      </div>

      {/* How this works explanation */}
      <div className="rounded-xl border border-gray-800/60 bg-[var(--accent-bg)] p-5">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">How the math works</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-500">
          <div>
            <p className="text-gray-400 font-semibold mb-1">Net to Pay</p>
            <p>Total spend on the card minus any cashback you redeem to cover losses. This is what you actually owe.</p>
          </div>
          <div>
            <p className="text-gray-400 font-semibold mb-1">Redeem</p>
            <p>When a sold item has a full P&amp;L loss (cost + fees &gt; revenue), cashback is applied first to cover it. Only the minimum needed is redeemed.</p>
          </div>
          <div>
            <p className="text-gray-400 font-semibold mb-1">Keep as Points</p>
            <p>Any cashback left over after covering losses stays in your rewards balance — no need to redeem. Pending items show cashback but no P&amp;L until sold.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreditCard;
