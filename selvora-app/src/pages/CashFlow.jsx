import React, { useState } from 'react';
import { useDashboard, useInvalidate } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import { DollarSign, ArrowRight, Bell, ChevronRight, ChevronDown, RotateCcw } from 'lucide-react';

function fmt(n) {
  return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const UNPAID_STATUSES = new Set(['SOLD', 'SHIPPED_OUT', 'AUTHENTICATION', 'DELIVERED', 'SCANNED_IN']);
const PAID_STATUSES   = new Set(['PAID', 'COMPLETED']);

function CashFlow() {
  const [includeCashback, setIncludeCashback] = useState(false);
  const [expandedBuyer, setExpandedBuyer]     = useState(null);

  const { data, isLoading: loading, refetch } = useDashboard('All', 'All Time');
  const invalidate = useInvalidate();

  const s      = data?.stats ?? {};
  const txns   = data?.recentTransactions ?? [];
  const pipeline = data?.pipelineCounts ?? {};

  // Money still in transit (unsold inventory value)
  const inTransitValue = s.inventoryValue ?? 0;
  // Money that came back from sales
  const soldRevenue    = s.totalRevenue ?? 0;
  // Total owed = unpaid sale revenue (SOLD but not PAID/COMPLETED)
  const owedRevenue = txns
    .filter(t => UNPAID_STATUSES.has((t.status || '').toUpperCase()))
    .reduce((sum, t) => sum + (t.revenue ?? 0), 0);

  // Total spending out = purchase spend
  const spendingOut = s.totalCost ?? 0;
  // Coming back = sold revenue + (cashback earned if toggle on)
  const comingBack = soldRevenue + (includeCashback ? (s.totalCashback ?? 0) : 0);

  // Pipeline counts for the progress bar
  const inTransitCount = (pipeline['PURCHASED'] ?? 0) + (pipeline['SHIPPED_IN'] ?? 0) +
    (pipeline['DELIVERED'] ?? 0) + (pipeline['SCANNED_IN'] ?? 0) +
    (pipeline['LISTED'] ?? 0) + (pipeline['SHIPPED_OUT'] ?? 0) +
    (pipeline['AUTHENTICATION'] ?? 0);
  const soldCount = (pipeline['SOLD'] ?? 0) + (pipeline['PAID'] ?? 0) + (pipeline['COMPLETED'] ?? 0);
  const totalPipelineUnits = inTransitCount + soldCount || 1;
  const inTransitPct = Math.round((inTransitCount / totalPipelineUnits) * 100);
  const soldPct      = 100 - inTransitPct;

  // Group recent transactions by buyer
  const buyerMap = new Map();
  txns.forEach(t => {
    const key = t.buyer || 'Unknown';
    if (!buyerMap.has(key)) {
      buyerMap.set(key, { name: key, items: 0, spent: 0, comingBack: 0, cashback: 0, sales: [] });
    }
    const b = buyerMap.get(key);
    b.items++;
    b.spent      += t.cost    ?? 0;
    b.comingBack += t.revenue ?? 0;
    b.cashback   += t.cashback ?? 0;
    b.sales.push(t);
  });
  const buyers = Array.from(buyerMap.values());

  const toggleBuyer = (name) => setExpandedBuyer(expandedBuyer === name ? null : name);

  if (loading) return <PageLoader variant="generic" />;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-10 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Cash Flow</h1>
          <p className="text-sm text-gray-400 mt-1">See where your money is and what's coming back</p>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors"
        >
          <RotateCcw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: 'var(--accent-bg)' }}>
          <div>
            <h3 className="text-[10px] font-bold text-[#60a5fa] uppercase tracking-wider mb-2">Spending Out</h3>
            <div className="text-xl font-bold text-blue-400 mb-1">{loading ? '…' : `$${fmt(spendingOut)}`}</div>
            <p className="text-[10px] text-blue-400/60">{s.transactionCount ?? 0} items purchased</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-blue-500/30 flex items-center justify-center bg-blue-500/10">
            <DollarSign size={14} className="text-blue-400" />
          </div>
        </div>

        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: 'var(--green-bg)' }}>
          <div>
            <h3 className="text-[10px] font-bold text-[#4ade80] uppercase tracking-wider mb-2">Coming Back</h3>
            <div className="text-xl font-bold text-green-400 mb-1">{loading ? '…' : `$${fmt(comingBack)}`}</div>
            <p className="text-[10px] text-green-400/60">net after buyer fees{includeCashback ? ' + cashback' : ''}</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-green-500/30 flex items-center justify-center bg-green-500/10">
            <ArrowRight size={14} className="text-green-400" />
          </div>
        </div>

        <div className="rounded-xl p-5 border border-gray-800 flex justify-between items-start" style={{ backgroundColor: 'var(--accent-bg)' }}>
          <div>
            <h3 className="text-[10px] font-bold text-[#c084fc] uppercase tracking-wider mb-2">Owed To You</h3>
            <div className="text-xl font-bold text-purple-400 mb-1">{loading ? '…' : `$${fmt(owedRevenue)}`}</div>
            <p className="text-[10px] text-purple-400/60">unpaid / in-transit sales</p>
          </div>
          <div className="w-8 h-8 rounded-full border border-purple-500/30 flex items-center justify-center bg-purple-500/10">
            <DollarSign size={14} className="text-purple-400" />
          </div>
        </div>
      </div>

      {/* Progress Section */}
      <div className="space-y-4 pt-2">
        <div className="flex justify-end items-center gap-3">
          <span className="text-xs text-gray-500">Include cashback</span>
          <button
            onClick={() => setIncludeCashback(!includeCashback)}
            className={`w-9 h-5 rounded-full relative transition-colors ${includeCashback ? 'bg-[var(--green)]' : 'bg-gray-700'}`}
          >
            <div className={`absolute top-0.5 bottom-0.5 left-0.5 w-4 rounded-full transition-transform ${includeCashback ? 'translate-x-4 bg-white' : 'bg-gray-300'}`} />
          </button>
        </div>

        <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6">
          <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-6">Where Your Money Is</h3>

          {/* Progress Bar */}
          <div className="h-4 w-full rounded-full bg-gray-800 overflow-hidden flex mb-6">
            {inTransitPct > 0 && <div className="h-full bg-yellow-500 transition-all" style={{ width: `${inTransitPct}%` }} />}
            {soldPct > 0 && <div className="h-full bg-green-500 transition-all" style={{ width: `${soldPct}%` }} />}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded border border-yellow-500/30 bg-yellow-500/5 p-3">
              <div className="text-[10px] font-bold text-yellow-500/80 uppercase tracking-wider mb-1">In Transit / Listed</div>
              <div className="text-sm font-bold text-yellow-500 mb-0.5">{loading ? '…' : `$${fmt(inTransitValue)}`}</div>
              <div className="text-[10px] text-yellow-500/60">{inTransitCount} unit{inTransitCount !== 1 ? 's' : ''} · {inTransitPct}%</div>
            </div>

            <div className="rounded border border-green-500/30 bg-green-500/5 p-3">
              <div className="text-[10px] font-bold text-green-500/80 uppercase tracking-wider mb-1">Sold</div>
              <div className="text-sm font-bold text-green-500 mb-0.5">{loading ? '…' : `$${fmt(soldRevenue)}`}</div>
              <div className="text-[10px] text-green-500/60">{soldCount} unit{soldCount !== 1 ? 's' : ''} · {soldPct}%</div>
            </div>

            {(s.totalCashback ?? 0) > 0 && (
              <div className="rounded border border-purple-500/30 bg-purple-500/5 p-3">
                <div className="text-[10px] font-bold text-purple-500/80 uppercase tracking-wider mb-1">Cashback Earned</div>
                <div className="text-sm font-bold text-purple-400 mb-0.5">{loading ? '…' : `$${fmt(s.totalCashback)}`}</div>
                <div className="text-[10px] text-purple-500/60">at point of purchase</div>
              </div>
            )}

            {owedRevenue > 0 && (
              <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="text-[10px] font-bold text-amber-500/80 uppercase tracking-wider mb-1">Unpaid</div>
                <div className="text-sm font-bold text-amber-400 mb-0.5">{loading ? '…' : `$${fmt(owedRevenue)}`}</div>
                <div className="text-[10px] text-amber-500/60">awaiting payout</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* By Buyer */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider ml-1">By Buyer</h3>

        {buyers.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-[#12121A] p-6 text-center text-gray-600 text-sm">No sales data yet.</div>
        )}

        {buyers.length > 0 && (
          <div className="border border-gray-800 bg-[#12121A] rounded-xl overflow-hidden divide-y divide-gray-800">
            {buyers.map(buyer => (
              <div key={buyer.name} className="group">
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => toggleBuyer(buyer.name)}
                >
                  <div className="flex items-center gap-4">
                    {expandedBuyer === buyer.name
                      ? <ChevronDown size={16} className="text-gray-500" />
                      : <ChevronRight size={16} className="text-gray-500" />
                    }
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-white text-sm">{buyer.name}</span>
                        <span className="text-xs text-gray-500">{buyer.items} sale{buyer.items !== 1 ? 's' : ''}</span>
                        {buyer.sales.some(t => UNPAID_STATUSES.has((t.status || '').toUpperCase())) && (
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                            <Bell size={10} /> Pending
                          </div>
                        )}
                      </div>
                      <div className="flex h-1 w-24 rounded-full overflow-hidden mt-2 bg-gray-800">
                        <div className="h-full bg-green-500" style={{ width: '100%' }} />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-12 text-right">
                    <div>
                      <div className="text-[10px] text-gray-500 mb-1">Cost</div>
                      <div className="text-sm font-bold text-blue-400">${fmt(buyer.spent)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 mb-1">Coming Back</div>
                      <div className="text-sm font-bold text-green-400">
                        ${fmt(buyer.comingBack + (includeCashback ? buyer.cashback : 0))}
                      </div>
                    </div>
                  </div>
                </div>

                {expandedBuyer === buyer.name && (
                  <div className="px-14 py-3 bg-black/20 border-t border-gray-800/50">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-600 uppercase tracking-wider text-[10px]">
                          <th className="text-left pb-2">Product</th>
                          <th className="text-left pb-2">Date</th>
                          <th className="text-right pb-2">Cost</th>
                          <th className="text-right pb-2">Revenue</th>
                          <th className="text-right pb-2">Profit</th>
                          <th className="text-right pb-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {buyer.sales.map(t => (
                          <tr key={t.id}>
                            <td className="py-2 text-gray-300 max-w-[160px] truncate pr-4">{t.product}</td>
                            <td className="py-2 text-gray-500">{new Date(t.date).toLocaleDateString()}</td>
                            <td className="py-2 text-right text-blue-400">${fmt(t.cost)}</td>
                            <td className="py-2 text-right text-green-400">${fmt(t.revenue)}</td>
                            <td className={`py-2 text-right font-semibold ${(t.profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {(t.profit ?? 0) >= 0 ? '+' : ''}${fmt(t.profit)}
                            </td>
                            <td className="py-2 text-right">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                PAID_STATUSES.has((t.status || '').toUpperCase())
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                              }`}>{t.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CashFlow;
