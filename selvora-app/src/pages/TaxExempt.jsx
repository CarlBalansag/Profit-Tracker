import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../hooks/useApi';
import { ShieldCheck, Search, Package, DollarSign, Info } from 'lucide-react';
import { PageLoader } from '../components/PageLoader';

function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);
  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="text-gray-600 hover:text-gray-400 transition-colors ml-1 flex-shrink-0"
      >
        <Info className="w-3 h-3" />
      </button>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 bg-[#1a1a2e] border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-gray-300 leading-relaxed shadow-xl z-50 pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1a1a2e]" />
        </div>
      )}
    </span>
  );
}

const STATUS_COLORS = {
  'Pre Order':    'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  'On Hand':      'bg-teal-500/10 text-teal-400 border-teal-500/20',
  PURCHASED:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
  SHIPPED_IN:     'bg-purple-500/10 text-purple-400 border-purple-500/20',
  DELIVERED:      'bg-orange-500/10 text-orange-400 border-orange-500/20',
  SCANNED_IN:     'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  LISTED:         'bg-amber-500/10 text-amber-400 border-amber-500/20',
  SOLD:           'bg-green-500/10 text-green-400 border-green-500/20',
  SHIPPED_OUT:    'bg-sky-500/10 text-sky-400 border-sky-500/20',
  AUTHENTICATION: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  PAID:           'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  COMPLETED:      'bg-teal-500/10 text-teal-400 border-teal-500/20',
  RETURNED:       'bg-red-500/10 text-red-400 border-red-500/20',
  DISPUTED:       'bg-rose-500/10 text-rose-400 border-rose-500/20',
  CANCELLED:      'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const QUARTERS = [
  { value: 'all', label: 'All Quarters' },
  { value: '1',   label: 'Q1 (Jan–Mar)' },
  { value: '2',   label: 'Q2 (Apr–Jun)' },
  { value: '3',   label: 'Q3 (Jul–Sep)' },
  { value: '4',   label: 'Q4 (Oct–Dec)' },
];

const TaxExempt = () => {
  const [items, setItems] = useState([]);
  const [totalSalesCount, setTotalSalesCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('purchases');
  const [filterYear, setFilterYear] = useState('all');
  const [filterQuarter, setFilterQuarter] = useState('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [invRes, salesRes] = await Promise.all([
          apiFetch(`/api/inventory`, { credentials: 'include' }),
          apiFetch(`/api/sales`, { credentials: 'include' }),
        ]);
        if (invRes.ok) {
          const data = await invRes.json();
          setItems(data.filter(i => i.tax_exempt === true));
        }
        if (salesRes.ok) {
          const salesData = await salesRes.json();
          setTotalSalesCount(salesData.length);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const q = search.toLowerCase();

  // Derive available years from purchase dates + sale dates
  const allYears = [...new Set([
    ...items.map(i => new Date(i.purchase_date).getFullYear()),
    ...items.flatMap(i => (i.sales || []).map(s => new Date(s.sale_date).getFullYear())),
  ])].sort((a, b) => b - a);

  // Helper: does a date pass the year/quarter filter?
  const inPeriod = (dateStr) => {
    const d = new Date(dateStr);
    const yr = d.getFullYear();
    const q = Math.ceil((d.getMonth() + 1) / 3);
    if (filterYear !== 'all' && yr !== parseInt(filterYear)) return false;
    if (filterQuarter !== 'all' && q !== parseInt(filterQuarter)) return false;
    return true;
  };

  const filteredPurchases = items.filter(i =>
    inPeriod(i.purchase_date) && (
      i.product_name.toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q) ||
      (i.vendor?.name || '').toLowerCase().includes(q)
    )
  );

  // Flatten all sales from tax-exempt inventory items
  const allSales = items.flatMap(i =>
    (i.sales || []).map(s => ({ ...s, _inv: i }))
  );
  const filteredSales = allSales.filter(s =>
    inPeriod(s.sale_date) && (
      s._inv.product_name.toLowerCase().includes(q) ||
      (s._inv.category || '').toLowerCase().includes(q) ||
      (s._inv.vendor?.name || '').toLowerCase().includes(q) ||
      (s.platform?.name || '').toLowerCase().includes(q)
    )
  );

  // Stats use period-filtered data too
  const periodSales = allSales.filter(s => inPeriod(s.sale_date));
  const periodItems = items.filter(i => inPeriod(i.purchase_date));

  const totalTaxRecorded = filteredPurchases.reduce((sum, i) => sum + (i.sales_tax || 0), 0);
  const totalSaleRevenue = filteredSales.reduce((sum, s) => sum + (s.unit_price * s.quantity), 0);

  // Stats scoped to the selected period
  const nonTaxableSales = periodSales.filter(s => !s.taxable);
  const exemptSalesPct = totalSalesCount > 0 ? ((nonTaxableSales.length / totalSalesCount) * 100) : 0;
  const useTaxDue = periodItems.reduce((sum, i) => sum + (i.sales_tax || 0), 0);
  const exemptCOGS = periodSales.reduce((sum, s) => sum + (s._inv.unit_purchase_cost * s.quantity), 0);
  const exemptInventorySpend = periodItems.reduce((sum, i) => sum + (i.unit_purchase_cost * i.qty_purchased) + (i.sales_tax || 0) + (i.shipping_cost_inbound || 0), 0);
  const exemptRevenue = periodSales.reduce((sum, s) => sum + (s.unit_price * s.quantity), 0);
  const exemptProfit = periodSales.reduce((sum, s) => {
    const rev = s.unit_price * s.quantity;
    const cogs = s._inv.unit_purchase_cost * s.quantity;
    const fees = (s.commission_fee || 0) + (s.sale_shipping || 0);
    return sum + (rev - cogs - fees);
  }, 0);

  const tabs = [
    { id: 'purchases', label: 'Purchases', icon: Package, count: filteredPurchases.length },
    { id: 'sales',     label: 'Sales',     icon: DollarSign, count: filteredSales.length },
  ];

  if (isLoading) return <PageLoader variant="taxexempt" />;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-blue-400" />
            Tax Exempt
          </h1>
          <p className="text-gray-400 text-sm mt-1">Transactions marked as tax exempt</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={filterYear}
            onChange={e => setFilterYear(e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500/50 transition-colors appearance-none cursor-pointer"
          >
            <option value="all">All Years</option>
            {allYears.map(yr => (
              <option key={yr} value={yr}>{yr}</option>
            ))}
          </select>
          <select
            value={filterQuarter}
            onChange={e => setFilterQuarter(e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500/50 transition-colors appearance-none cursor-pointer"
          >
            {QUARTERS.map(q => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Top row — 4 primary metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="flex items-center mb-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Tax-Exempt Sales</p>
            <InfoTooltip text="Total revenue from sales marked as non-taxable (taxable = No)." />
          </div>
          <p className="text-2xl font-bold text-green-400">${exemptRevenue.toFixed(2)}</p>
          <p className="text-xs text-gray-600 mt-0.5">Non-taxable sales</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center mb-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Exempt Sales %</p>
            <InfoTooltip text="Percentage of your total sale transactions that are non-taxable." />
          </div>
          <p className="text-2xl font-bold text-blue-400">{exemptSalesPct.toFixed(1)}%</p>
          <p className="text-xs text-gray-600 mt-0.5">of total transactions</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center mb-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Use Tax Due</p>
            <InfoTooltip text="Sales tax you paid when purchasing exempt inventory. This may be reportable or recoverable depending on your state." />
          </div>
          <p className="text-2xl font-bold text-amber-400">${useTaxDue.toFixed(2)}</p>
          <p className="text-xs text-gray-600 mt-0.5">From exempt purchases</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center mb-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Exempt Transactions</p>
            <InfoTooltip text="Total number of individual sale records where the sale was marked non-taxable." />
          </div>
          <p className="text-2xl font-bold text-white">{nonTaxableSales.length}</p>
          <p className="text-xs text-gray-600 mt-0.5">Non-taxable sale records</p>
        </div>
      </div>

      {/* Second row — 4 smaller inventory/P&L metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 -mt-2">
        <div className="card px-3 py-2.5">
          <div className="flex items-center mb-0.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Exempt Inv. Purchased</p>
            <InfoTooltip text="Total amount spent buying tax-exempt inventory (unit cost × qty + tax + inbound shipping)." />
          </div>
          <p className="text-base font-bold text-white">${exemptInventorySpend.toFixed(2)}</p>
        </div>
        <div className="card px-3 py-2.5">
          <div className="flex items-center mb-0.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Exempt COGS</p>
            <InfoTooltip text="Cost of goods sold — unit purchase cost × quantity sold for exempt inventory items." />
          </div>
          <p className="text-base font-bold text-white">${exemptCOGS.toFixed(2)}</p>
        </div>
        <div className="card px-3 py-2.5">
          <div className="flex items-center mb-0.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Exempt Revenue</p>
            <InfoTooltip text="Total sale revenue generated from tax-exempt inventory items." />
          </div>
          <p className="text-base font-bold text-green-400">${exemptRevenue.toFixed(2)}</p>
        </div>
        <div className="card px-3 py-2.5">
          <div className="flex items-center mb-0.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Exempt Profit</p>
            <InfoTooltip text="Revenue minus COGS minus platform fees and shipping for all exempt inventory sales." />
          </div>
          <p className={`text-base font-bold ${exemptProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>${exemptProfit.toFixed(2)}</p>
        </div>
      </div>

      {/* Chrome-style tabs + Search row */}
      <div className="flex items-end justify-between gap-4">
        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-[#111318] border border-white/5 w-max">
          {tabs.map(({ id, label, icon: Icon, count }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'text-white bg-white/[0.08] border border-white/10 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 border border-transparent hover:bg-white/5'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-blue-400' : ''}`} />
                {label}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-gray-500'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 text-sm">Loading...</div>
        ) : tab === 'purchases' ? (
          filteredPurchases.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No tax exempt purchases found</p>
              <p className="text-gray-600 text-xs mt-1">Mark items as tax exempt when adding or editing a transaction</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 text-left">Product Name</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Vendor</th>
                    <th className="px-4 py-3 text-right">Quantity</th>
                    <th className="px-4 py-3 text-right">Unit Cost</th>
                    <th className="px-4 py-3 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredPurchases.map(item => {
                    const totalCost = (item.unit_purchase_cost * item.qty_purchased) + (item.sales_tax || 0) + (item.shipping_cost_inbound || 0);
                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{item.product_name}</td>
                        <td className="px-4 py-3 text-gray-400">
                          {new Date(item.purchase_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{item.vendor?.name || '—'}</td>
                        <td className="px-4 py-3 text-right text-gray-400">{item.qty_purchased}</td>
                        <td className="px-4 py-3 text-right text-gray-200">${item.unit_purchase_cost.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-white font-medium">${totalCost.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-white/[0.08] bg-white/[0.02]">
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-400 text-right">Total Spend</td>
                    <td className="px-4 py-3 text-right font-bold text-white">
                      ${filteredPurchases.reduce((sum, i) => sum + (i.unit_purchase_cost * i.qty_purchased) + (i.sales_tax || 0) + (i.shipping_cost_inbound || 0), 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : (
          filteredSales.length === 0 ? (
            <div className="p-12 text-center">
              <DollarSign className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No sales from tax exempt items</p>
              <p className="text-gray-600 text-xs mt-1">Sales linked to tax exempt inventory will appear here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Date Sold</th>
                    <th className="px-4 py-3 text-left">Place Sold</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3 text-center">Taxable</th>
                    <th className="px-4 py-3 text-right">Tax Collected</th>
                    <th className="px-4 py-3 text-center">Customer Exempt</th>
                    <th className="px-4 py-3 text-left">Exemption Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredSales.map(sale => {
                    const saleTotal = sale.unit_price * sale.quantity;
                    return (
                      <tr key={sale.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{sale._inv.product_name}</td>
                        <td className="px-4 py-3 text-gray-400">
                          {new Date(sale.sale_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{sale.platform?.name || '—'}</td>
                        <td className="px-4 py-3 text-right text-green-400 font-medium">${saleTotal.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${sale.taxable ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {sale.taxable ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-blue-400">
                          {sale.sale_tax_collected > 0 ? `$${Number(sale.sale_tax_collected).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${sale.customer_tax_exempt ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {sale.customer_tax_exempt ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400">{sale.exemption_type || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default TaxExempt;
